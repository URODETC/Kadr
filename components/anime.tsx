"use client";
import { useCallback, useEffect, useState } from "react";
import Link from 'next/link';
import SearchSuggestions from '@/components/search-suggestions';
import {useRouter} from 'next/navigation';
import {watchUrl,type WatchPage} from '@/lib/watch-page';
import HistoryShelf from "@/components/history-shelf";
import {getProgress,clock,type WatchRecord} from "@/lib/watch";
import ExtractorBrowser from "@/components/extractor-browser";
import { Player } from "@/components/cinema/player";
import type { Playback } from "@/lib/cinema/types";
type Episode = {
  id: string;
  ordinal: number;
  name: string | null;
  hls_1080: string | null;
  hls_720: string | null;
  hls_480: string | null;
};
type Release = {
  id: number;
  name: { main: string; english: string };
  year: number;
  description: string;
  poster: { optimized?: { src: string }; src: string };
  episodes?: Episode[];
  episodes_total: number;
  genres?: { name: string }[];
  is_blocked_by_geo?: boolean;
  is_blocked_by_copyrights?: boolean;
};
function image(r: Release) {
  const src = r.poster?.optimized?.src || r.poster?.src;
  return src ? new URL(src, "https://aniliberty.top").href : "";
}
async function api(url: string, signal?: AbortSignal) {
  const r = await fetch(url, { signal });
  if (r.status === 401) {
    location.replace("/login");
    throw new Error("Сессия истекла.");
  }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Ошибка источника");
  return d;
}
export default function Anime({
  user, watchPage,
}: {
  watchPage?: WatchPage;
  user: { id: number; username: string; role: string };
}) {
  const router=useRouter();
  const [external,setExternal]=useState(watchPage?.provider!=="anilibria");
  const [resumeItem,setResumeItem]=useState<WatchRecord|null>(null),[records,setRecords]=useState<WatchRecord[]>([]);
  const [saved, setSaved] = useState<Release[]>([]),
    [savedOnly, setSavedOnly] = useState(false);
  useEffect(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem(`anime:${user.id}:saved`) || "[]",
      );
      if (Array.isArray(value))
        setSaved(
          value.filter((r) => r && Number.isInteger(r.id) && r.name?.main),
        );
    } catch {}
  }, [user.id]);
  function toggleSaved(r: Release) {
    setSaved((old) => {
      const next = old.some((x) => x.id === r.id)
        ? old.filter((x) => x.id !== r.id)
        : [r, ...old];
      try {
        localStorage.setItem(`anime:${user.id}:saved`, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const [searchText,setSearchText]=useState("");
  const suggest=useCallback(async(q:string,signal:AbortSignal)=>{const data=savedOnly?saved:await api(`/api/anime?q=${encodeURIComponent(q)}&page=1`,signal);const rows:Release[]=Array.isArray(data)?data:data.data||[];return rows.filter(r=>!savedOnly||r.name.main.toLowerCase().includes(q.toLowerCase())).map(r=>({id:String(r.id),title:r.name.main,image:image(r),subtitle:r.year?String(r.year):undefined,href:watchUrl({provider:"anilibria",id:String(r.id),title:r.name.main})}));},[savedOnly,saved]);
  const [items, setItems] = useState<Release[]>([]),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [hasNext, setHasNext] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Release | null>(watchPage?.provider==="anilibria"?{id:Number(watchPage.id),name:{main:watchPage.title||"Аниме",english:""},year:0,description:"",poster:{src:""},episodes_total:0}:null),
    [episode, setEpisode] = useState<Episode | null>(null),
    [detailError, setDetailError] = useState(""),
    [detailLoading, setDetailLoading] = useState(false),
    [playback, setPlayback] = useState<Playback | null>(null);
  useEffect(() => {
    if(external)return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api(
        `/api/anime?q=${encodeURIComponent(query)}&page=${page}`,
        abort.signal,
      )
        .then((d) => {
          setItems(Array.isArray(d) ? d : d.data || []);
          setHasNext(!!d.meta?.pagination?.links?.next);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, page, retry, external]);
  const id = selected?.id;
  useEffect(() => {
    if (!id) return;
    const abort = new AbortController();
    setDetailLoading(true);
    setDetailError("");
    setEpisode(null);
    setPlayback(null);
    Promise.all([api("/api/anime/" + id, abort.signal),getProgress(`anilibria:${id}`,abort.signal)])
      .then(([d,rows]) => {
        setSelected(d);setRecords(rows);
        const last=rows[0];const index=d.episodes?.findIndex((e:Episode)=>e.id===last?.episodeKey)??-1;
        setEpisode(d.episodes?.[index>=0?(last.watched&&d.episodes[index+1]?index+1:index):0]||null);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setDetailError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setDetailLoading(false);
      });
    return () => abort.abort();
  }, [id, user.id, retry]);
  useEffect(()=>{if(!id)return;let active=true;const load=()=>getProgress(`anilibria:${id}`).then(rows=>{if(active)setRecords(rows);}).catch(()=>{});window.addEventListener('watch-progress',load);return()=>{active=false;window.removeEventListener('watch-progress',load);};},[id]);
  useEffect(()=>{if(episode)play(episode);},[episode]);
  function play(e: Episode) {
    const sources = [
      { url: e.hls_1080, quality: 1080 },
      { url: e.hls_720, quality: 720 },
      { url: e.hls_480, quality: 480 },
    ]
      .filter((s): s is { url: string; quality: number } => !!s.url)
      .map((s) => ({ ...s, mime: "application/x-mpegURL" }));
    setPlayback(
      sources.length
        ? {
            sources,
            subtitles: [],
            audios: [{ lang: "ru", label: "AniLiberty", original: false }],
          }
        : null,
    );
    if (!sources.length) setDetailError("У этой серии нет доступного потока.");
  }
  const key = `anime:${user.id}:${id}:${episode?.id}`;
  return (
    <main className="anime-app">
      <header>
        <Link className="brand" href="/">
          кадр<span> / anime</span>
        </Link>
        <div className="account">
          <span>{user.username}</span>
          {user.role === "admin" && <a href="/admin">Участники</a>}
          <button
            onClick={async () => {
              try {
                await fetch("/api/auth/logout", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                });
              } finally {
                location.replace("/login");
              }
            }}
          >
            Выйти
          </button>
        </div>
      </header>
      {!watchPage&&<><section className="anime-heading">
        <div>
          <h1>Аниме</h1>
        </div>
        {!external&&<SearchSuggestions value={searchText} onChange={setSearchText} load={suggest} onSelect={i=>router.push(i.href)} onSearch={q=>{setQuery(q);setPage(1);}}/>}
      </section>
      <HistoryShelf onResume={r=>{if(r.provider==='anilibria'){setExternal(false);setSavedOnly(false);router.push(watchUrl({provider:"anilibria",id:r.titleKey.split(":")[1],title:r.title}));}else{setExternal(true);setResumeItem({...r});}}}/>
      <div className="library-tabs">
        <button onClick={()=>setExternal(true)} aria-pressed={external}>Все источники</button>
        <button onClick={() => {setExternal(false);setSavedOnly(false);}} aria-pressed={!external&&!savedOnly}>
          AniLiberty
        </button>
        <button onClick={() => {setExternal(false);setSavedOnly(true);}} aria-pressed={!external&&savedOnly}>
          Буду смотреть · {saved.length}
        </button>
      </div>
      {external?<ExtractorBrowser userId={user.id} resume={resumeItem}/>:!savedOnly && loading ? (
        <p role="status">Загружаем аниме…</p>
      ) : !savedOnly && error ? (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setRetry((v) => v + 1)}>Повторить</button>
        </div>
      ) : (
        <>
          <div className="anime-grid">
            {(savedOnly
              ? saved.filter((r) =>
                  r.name.main.toLowerCase().includes(query.toLowerCase()),
                )
              : items
            ).map((r) => (
              <button
                className="anime-card"
                key={r.id}
                onClick={() => router.push(watchUrl({provider:"anilibria",id:String(r.id),title:r.name.main}))}
              >
                {image(r) ? (
                  <img src={image(r)} alt="" loading="lazy" />
                ) : (
                  <div className="poster-placeholder" />
                )}
                <h2>{r.name.main}</h2>
                <p>
                  {r.year} · {r.episodes_total || "…"} серий
                </p>
              </button>
            ))}
          </div>
          {!(savedOnly ? saved : items).length && (
            <p>Ничего не найдено. Попробуйте другое название.</p>
          )}
          {!savedOnly && (
            <div className="pagination">
              <button
                disabled={page === 1}
                onClick={() => setPage((v) => v - 1)}
              >
                ← Назад
              </button>
              <span>Страница {page}</span>
              <button disabled={!hasNext} onClick={() => setPage((v) => v + 1)}>
                Далее →
              </button>
            </div>
          )}
        </>
      )}
      </>}
      {watchPage&&external&&<ExtractorBrowser userId={user.id} watchPage={watchPage}/>}
      {watchPage&&!external&&<section className="watch-page">
        <Link className="watch-back" href="/">← В каталог</Link>
          {selected && (
            <>
              <h1 className="watch-page-title">{selected.name.main}</h1>
              <p className="muted">
                {selected.name.english} · {selected.year}
              </p>
              {detailLoading ? (
                <p role="status">Загружаем серии…</p>
              ) : (
                <>
                  {detailError && (
                    <div className="error" role="alert">
                      {detailError}
                      <button onClick={() => setRetry((v) => v + 1)}>
                        Повторить
                      </button>
                    </div>
                  )}
                  <Player key={key} data={playback} storageKey={key}
                    watch={episode?{titleKey:`anilibria:${selected.id}`,episodeKey:episode.id,title:selected.name.main,provider:'anilibria',episode:episode.ordinal,poster:image(selected),sourceLabel:'AniLiberty'}:undefined}
                    title={episode?`Серия ${episode.ordinal}`:''} autoPlay
                    controls={<><label>Источник<select value="anilibria" onChange={()=>{router.push("/");}}><option value="anilibria">AniLiberty</option><option value="other">Другие источники…</option></select></label><label>Сезон / релиз<select value={selected.id} disabled><option value={selected.id}>{selected.name.main}</option></select></label><label>Серия<select value={episode?.id||''} onChange={e=>{setPlayback(null);setEpisode(selected.episodes?.find(x=>x.id===e.target.value)||null);}}>{selected.episodes?.map(e=>{const row=records.find(r=>r.episodeKey===e.id);return <option key={e.id} value={e.id}>{row?.watched?'✓ ':''}Серия {e.ordinal}{row&&!row.watched?` — ${clock(row.position)}`:''}</option>;})}</select></label><label>Озвучка<select disabled><option>AniLiberty</option></select></label></>}
                    onEnded={()=>{const list=selected.episodes||[];const next=list[list.findIndex(e=>e.id===episode?.id)+1];if(next){setPlayback(null);setEpisode(next);}}}
                    onNext={selected.episodes?.some(e=>e.ordinal>(episode?.ordinal||0))?()=>{const list=selected.episodes||[];const next=list[list.findIndex(e=>e.id===episode?.id)+1];if(next){setPlayback(null);setEpisode(next);}}:undefined}/>
                  <button onClick={() => toggleSaved(selected)}>
                    {saved.some((r) => r.id === selected.id)
                      ? "✓ В списке — убрать"
                      : "+ Буду смотреть"}
                  </button>
                  {!selected.episodes?.length && !detailError && (
                    <p>Серии ещё не опубликованы.</p>
                  )}
                  <details className="watch-description"><summary>Описание</summary><p>{selected.description?.replace(/<[^>]*>/g, "")}</p></details>
                </>
              )}
            </>
          )}
      </section>}

    </main>
  );
}
