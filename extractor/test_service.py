import time
import unittest
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace
from fastapi.testclient import TestClient
import service

class YummyEpisodeTests(unittest.TestCase):
    def test_long_series_with_fractional_episode_through_api(self):
        from anicli_api.source.yummy_anime import Anime, YummyAnimeApi
        anime = Anime(title='Ван-Пис', thumbnail='', description='', data={'anime_id':1512})
        def video(number):
            return {'number':str(number), 'iframe_url':'https://player.example/episode', 'data':{'dubbing':'Тест'}}
        videos = [video(n) for n in range(1200, 0, -1)]
        videos.extend([video('1168.5'),video('1168.50'),video('special'),video('NaN'),video('Infinity')])
        old_registry = service.registry
        service.registry = service.Registry()
        try:
            handle = service.registry.put('1','search',SimpleNamespace(a_get_anime=AsyncMock(return_value=anime)),'yummy_anime')
            result = SimpleNamespace(is_ok=True,value={'response':videos})
            with patch.object(YummyAnimeApi,'async_anime_videos',new=AsyncMock(return_value=result)), TestClient(service.app) as client:
                response = client.get('/anime/'+handle,headers={'X-User-Id':'1'})
                self.assertEqual(response.status_code,200,response.text)
                episodes = response.json()['episodes']
                self.assertEqual(len(episodes),1201)
                self.assertEqual(episodes[0]['ordinal'],1)
                self.assertEqual(episodes[-1]['ordinal'],1200)
                self.assertEqual(episodes[1167]['ordinal'],1168)
                self.assertEqual(episodes[1168]['ordinal'],1168.5)
                sources = client.get('/sources/'+episodes[1168]['id'],headers={'X-User-Id':'1'})
                self.assertEqual(sources.status_code,200)
                self.assertEqual(len(sources.json()['items']),2)
        finally:
            service.registry = old_registry

class KodikQualityTests(unittest.TestCase):
    def test_all_advertised_qualities_and_mirrors(self):
        decoder = SimpleNamespace(_decode=lambda value: value)
        videos = service.Kodik._extract(decoder, {
            '720': [{'src': 'https://cdn.example/720.m3u8'}],
            '1080': [{'src': 'https://cdn.example/1080.m3u8'}],
            '2160': [{'src': 'https://cdn.example/2160.m3u8'}, {'src': 'https://mirror.example/2160.m3u8'}],
            'metadata': {}, '480': [],
        })
        streams, blocked = service.normalize_videos(videos)
        self.assertEqual([s['quality'] for s in streams], [2160, 2160, 1080, 720])
        self.assertEqual(blocked, 0)

    def test_sparse_old_release_does_not_invent_higher_quality(self):
        videos = service.Kodik._extract(SimpleNamespace(_decode=lambda value: value), {
            '480': [{'src': 'https://cdn.example/480.m3u8'}],
        })
        self.assertEqual([v.quality for v in videos], [480])

class MockSource:
    title = 'Японский с субтитрами'
    url = 'https://player.example/episode'
    async def a_get_videos(self):
        return [SimpleNamespace(url='https://cdn.example/1080.m3u8', quality=1080, type='m3u8', headers={})]
class MockEpisode:
    title = 'Начало'
    ordinal = 1
    async def a_get_sources(self):
        return [MockSource()]
class MockAnime:
    title = 'Тестовое аниме'
    description = 'Описание'
    async def a_get_episodes(self):
        return [MockEpisode()]
class MockSearch:
    title = 'Тестовое аниме'
    thumbnail = '/poster.jpg'
    url = '/anime/1'
    async def a_get_anime(self):
        return MockAnime()
class MockExtractor:
    BASE_URL = 'https://anime.example'
    async def a_search(self, q):
        return [MockSearch()]
    async def a_ongoing(self):
        return [MockSearch()]

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.old = service.extractors.copy()
        service.extractors['animego'] = MockExtractor()
        service.registry = service.Registry()
        self.client = TestClient(service.app)
        self.headers = {'X-User-Id': '1'}
    def tearDown(self):
        service.extractors.clear()
        service.extractors.update(self.old)
        self.client.close()
    def get(self,path):
        r = self.client.get(path,headers=self.headers)
        self.assertEqual(r.status_code,200,r.text)
        return r.json()
    def test_complete_pipeline_and_owner_isolation(self):
        found=self.get('/search/animego?q=test')['items'][0]
        self.assertEqual(found['thumbnail'],'https://anime.example/poster.jpg')
        self.assertNotIn('url',found)
        self.assertEqual(self.client.get('/anime/'+found['id'],headers={'X-User-Id':'2'}).status_code,410)
        anime=self.get('/anime/'+found['id'])
        sources=self.get('/sources/'+anime['episodes'][0]['id'])
        self.assertEqual(sources['items'][0]['title'],'Японский с субтитрами')
        playback=self.get('/playback/'+sources['items'][0]['id'])
        self.assertEqual(playback['sources'][0]['quality'],1080)
        self.assertEqual(playback['subtitles'],[]) # Do not invent external subtitle files.
    def test_no_public_access_or_arbitrary_urls(self):
        self.assertEqual(self.client.get('/providers').status_code,401)
        self.assertEqual(self.client.get('/search/not_a_module',headers=self.headers).status_code,404)
        self.assertEqual(self.client.get('/playback/arbitrary',headers=self.headers).status_code,410)
        for url in ['http://127.0.0.1/x','http://[::1]/','http://169.254.169.254/','file:///etc/passwd','https://u:p@example.com','javascript:alert(1)']:
            self.assertEqual(service.public_url(url),'')
    def test_expiry_and_wrong_handle_kind(self):
        key=service.registry.put('1','search',MockSearch(),'animego')
        self.assertEqual(self.client.get('/sources/'+key,headers=self.headers).status_code,410)
        service.registry.items[key].expires=time.monotonic()-1
        self.assertEqual(self.client.get('/anime/'+key,headers=self.headers).status_code,410)
    def test_sort_quality_and_reject_required_headers(self):
        def video(q,headers=None,url='https://cdn.example/video'):
            return SimpleNamespace(url=url,quality=q,type='mp4',headers=headers or {})
        items,blocked=service.normalize_videos([video(480),video(1080),video(720,{'Referer':'secret'}),video(1080,url='http://10.0.0.1/')])
        self.assertEqual([i['quality'] for i in items],[1080,480])
        self.assertEqual(blocked,1)
        self.assertNotIn('secret',str(items))
    def test_provider_failure_is_sanitized(self):
        class Broken(MockExtractor):
            async def a_search(self,q):
                raise RuntimeError('https://provider/?sid=secret')
        service.extractors['animego']=Broken()
        r=self.client.get('/search/animego?q=broken',headers=self.headers)
        self.assertEqual(r.status_code,502)
        self.assertNotIn('secret',r.text)

if __name__=='__main__':unittest.main()
