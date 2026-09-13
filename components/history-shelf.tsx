'use client';
import {useEffect,useState} from 'react';
import {getProgress,clock,type WatchRecord} from '@/lib/watch';
export default function HistoryShelf({onResume}:{onResume:(record:WatchRecord)=>void}){
 const [items,setItems]=useState<WatchRecord[]>([]);
 useEffect(()=>{let alive=true;const load=()=>getProgress().then(rows=>{if(alive)setItems(rows);}).catch(()=>{});void load();window.addEventListener('watch-progress',load);window.addEventListener('focus',load);return()=>{alive=false;window.removeEventListener('watch-progress',load);window.removeEventListener('focus',load);};},[]);
 if(!items.length)return null;
 return <section className="history-shelf"><h2>Продолжить</h2><div>{items.map(r=><button key={r.titleKey} onClick={()=>onResume(r)}>{r.poster&&<img src={r.poster} alt=""/>}<span><strong>{r.title}</strong><small>Серия {r.episode} · {r.watched?'просмотрена':clock(r.position)+' / '+clock(r.duration)}</small><progress max={r.duration} value={r.position}/></span></button>)}</div></section>;
}
