export type WatchIdentity={titleKey:string;episodeKey:string;title:string;provider:string;episode:number;poster:string;sourceLabel?:string};
export type WatchRecord=WatchIdentity&{position:number;duration:number;revision:number;watched:boolean;updatedAt:number};
export function clock(seconds:number){const value=Math.max(0,Math.floor(seconds));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;}
export async function getProgress(title?:string,signal?:AbortSignal):Promise<WatchRecord[]>{const r=await fetch('/api/progress'+(title?'?title='+encodeURIComponent(title):''),{signal,cache:'no-store'});if(!r.ok)throw new Error('Не удалось загрузить прогресс.');return (await r.json()).items;}
