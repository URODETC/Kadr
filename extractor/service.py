"""Private metadata/extraction service. Never downloads or proxies video segments."""
import asyncio
import hashlib
import importlib
import ipaddress
import logging
import math
import secrets
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import FastAPI, Header, HTTPException, Query
from anicli_api.player.base import Video
from anicli_api.player.kodik import Kodik


def extract_kodik_qualities(self, response_api):
    """Pinned anicli-api only reads 360/480/720; retain every advertised quality."""
    videos = []
    for key, entries in response_api.items():
        if not str(key).isdigit() or int(key) <= 0 or not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get('src'), str):
                continue
            url = self._decode(entry['src'])
            # Preserve the pinned decoder's workaround for Kodik's 720 response.
            if int(key) == 720:
                url = url.replace('/480.mp4:', '/720.mp4:')
            videos.append(Video(type='m3u8', quality=int(key), url=url))
    return videos


# Both sync and async Kodik paths call this method on the registered decoder.
Kodik._extract = extract_kodik_qualities


def yummy_episodes(anime, videos):
    """Preserve fractional recap episodes instead of failing int('1168.5')."""
    from anicli_api.source.yummy_anime import Episode
    grouped = {}
    for video in videos:
        iframe = video.get('iframe_url')
        if not isinstance(iframe, str) or not iframe or 'alloha' in iframe:
            continue
        try:
            number = float(video['number'])
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(number) or number < 0 or number > 100000:
            continue
        ordinal = int(number) if number.is_integer() else number
        grouped.setdefault(ordinal, []).append(video)
    return [Episode(title=f'Серия {number}', ordinal=number, data=grouped[number],
                    **anime._kwargs_http) for number in sorted(grouped)]


async def yummy_get_episodes(self):
    from anicli_api.source.yummy_anime import YummyAnimeApi
    result = await YummyAnimeApi.async_anime_videos(self.http_async, id=self.data['anime_id'])
    if not result.is_ok:
        raise HTTPException(502, 'Не удалось получить список серий YummyAnime. Повторите попытку.')
    return yummy_episodes(self, result.value['response'])


# The service only uses the async provider interface. Other providers are unchanged.
from anicli_api.source.yummy_anime import Anime as YummyAnime
YummyAnime.a_get_episodes = yummy_get_episodes

# Explicit allowlist: no user-selected imports, URLs, cookies or credentials.
PROVIDERS = {
    'anilibria': 'AniLiberty', 'animego': 'AnimeGO', 'yummy_anime': 'YummyAnime',
    'anilibme': 'AniLib', 'animevost': 'AnimeVost',
    'sameband': 'Sameband', 'dreamcast': 'Dream Cast',
}
logging.getLogger('anicli-api').disabled = True
logging.getLogger('httpx').setLevel(logging.WARNING)
TTL = 3600
LIMIT = 6000

@dataclass
class Entry:
    owner: str
    kind: str
    value: object
    provider: str
    expires: float

class Registry:
    def __init__(self):
        self.items = OrderedDict()

    def put(self, owner, kind, value, provider):
        now = time.monotonic()
        for key in list(self.items):
            if self.items[key].expires < now:
                del self.items[key]
        while len(self.items) >= LIMIT:
            self.items.popitem(last=False)
        handle = secrets.token_urlsafe(24)
        self.items[handle] = Entry(owner, kind, value, provider, now + TTL)
        return handle

    def get(self, owner, kind, handle):
        entry = self.items.get(handle)
        if not entry or entry.owner != owner or entry.kind != kind or entry.expires < time.monotonic():
            raise HTTPException(410, 'Данные устарели. Повторите поиск и откройте аниме заново.')
        entry.expires = time.monotonic() + TTL
        self.items.move_to_end(handle)
        return entry

registry = Registry()
extractors = {}
semaphore = asyncio.Semaphore(4)

def public_url(value, base=''):
    if not isinstance(value, str) or not value:
        return ''
    try:
        url = urljoin(base, 'https:' + value if value.startswith('//') else value)
        p = urlsplit(url)
        if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
            return ''
        if p.hostname == 'localhost' or p.hostname.endswith(('.localhost', '.local')):
            return ''
        try:
            if not ipaddress.ip_address(p.hostname).is_global:
                return ''
        except ValueError:
            pass
        return url
    except ValueError:
        return ''

async def guard_request(request):
    if not public_url(str(request.url)):
        raise ValueError('Non-public upstream URL')

@asynccontextmanager
async def lifespan(app):
    yield
    for ex in extractors.values():
        await ex.http_async.aclose()
        ex.http.close()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

def owner(value):
    if not value or not value.isdigit() or len(value) > 20:
        raise HTTPException(401, 'Требуется вход через сайт.')
    return value

def extractor(provider):
    if provider not in PROVIDERS:
        raise HTTPException(404, 'Неизвестный источник.')
    if provider not in extractors:
        # Standard HTTP clients, no browser cookies or automatic challenge solver.
        headers = {'User-Agent': 'Mozilla/5.0', 'Accept': '*/*'}
        client = httpx.AsyncClient(timeout=15, follow_redirects=True, headers=headers,
            limits=httpx.Limits(max_connections=12), event_hooks={'request': [guard_request]})
        sync = httpx.Client(timeout=15, follow_redirects=True, headers=headers)
        cls = importlib.import_module('anicli_api.source.' + provider).Extractor
        extractors[provider] = cls(http_client=sync, http_async_client=client)
    return extractors[provider]

async def bounded(call):
    try:
        async with asyncio.timeout(35):
            async with semaphore:
                return await call()
    except HTTPException:
        raise
    except TimeoutError:
        raise HTTPException(504, 'Источник не ответил вовремя. Попробуйте другой.') from None
    except Exception:
        # Upstream exceptions may contain signed media URLs; never return or log them.
        raise HTTPException(502, 'Источник недоступен или изменил формат. Выберите другой источник.') from None

@app.get('/health')
async def health():
    return {'ok': True}

@app.get('/providers')
async def providers(x_user_id: str | None = Header(default=None)):
    owner(x_user_id)
    return {'items': [{'id': k, 'title': v} for k, v in PROVIDERS.items()]}

@app.get('/search/{provider}')
async def search(provider: str, q: str = Query(default='', max_length=100), x_user_id: str | None = Header(default=None)):
    user = owner(x_user_id)
    ex = extractor(provider)
    results = await bounded(lambda: ex.a_search(q.strip()) if q.strip() else ex.a_ongoing())
    items, seen = [], set()
    for value in results[:100]:
        identity = getattr(value, 'url', value.title)
        if identity in seen:
            continue
        seen.add(identity)
        items.append({'id': registry.put(user, 'search', value, provider),
            'title': str(value.title), 'thumbnail': public_url(value.thumbnail, ex.BASE_URL),
            'key': hashlib.sha256(f'{provider}:{identity}'.encode()).hexdigest()[:24]})
    return {'items': items, 'provider': provider}

@app.get('/anime/{handle}')
async def anime(handle: str, x_user_id: str | None = Header(default=None)):
    user = owner(x_user_id)
    entry = registry.get(user, 'search', handle)
    async def resolve():
        anime = await entry.value.a_get_anime()
        episodes = await anime.a_get_episodes()
        return anime, episodes
    value, episodes = await bounded(resolve)
    return {'title': str(value.title), 'description': str(value.description or ''),
        'episodes': [{'id': registry.put(user, 'episode', e, entry.provider),
            'title': str(e.title), 'ordinal': e.ordinal} for e in episodes[:2500]]}

@app.get('/sources/{handle}')
async def sources(handle: str, x_user_id: str | None = Header(default=None)):
    user = owner(x_user_id)
    entry = registry.get(user, 'episode', handle)
    values = await bounded(entry.value.a_get_sources)
    return {'items': [{'id': registry.put(user, 'source', v, entry.provider),
        'title': str(v.title), 'player': urlsplit(public_url(v.url)).hostname or ''} for v in values[:150]]}

def normalize_videos(videos):
    result, blocked = [], 0
    types = {'m3u8': 'application/x-mpegURL', 'mpd': 'application/dash+xml',
        'mp4': 'video/mp4', 'webm': 'video/webm'}
    for v in videos:
        url = public_url(v.url)
        if not url or v.type not in types:
            continue
        # Browser cannot impersonate Referer/User-Agent/Cookie. Do not silently proxy video.
        if v.headers:
            blocked += 1
            continue
        result.append({'url': url, 'quality': max(0, int(v.quality or 0)), 'mime': types[v.type]})
    result.sort(key=lambda x: x['quality'], reverse=True)
    return result, blocked

@app.get('/playback/{handle}')
async def playback(handle: str, x_user_id: str | None = Header(default=None)):
    user = owner(x_user_id)
    entry = registry.get(user, 'source', handle)
    videos = await bounded(entry.value.a_get_videos)
    streams, blocked = normalize_videos(videos)
    if not streams:
        if blocked:
            raise HTTPException(422, 'Этот плеер требует специальных HTTP-заголовков. Для прямого просмотра в браузере выберите другой вариант.')
        raise HTTPException(422, 'Источник не вернул подходящий видеопоток. Выберите другой вариант.')
    return {'sources': streams, 'audios': [], 'subtitles': [],
        'label': str(entry.value.title),
        'notice': 'Язык и встроенные субтитры зависят от выбранного перевода. Отдельные файлы субтитров anicli-api не предоставляет.'}
