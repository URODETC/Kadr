export type WatchPage={provider:string;id:string;key?:string;title?:string;poster?:string};
export function watchUrl(page:WatchPage){
 const params=new URLSearchParams();
 for(const [key,value] of Object.entries(page))if(value)params.set(key,value);
 return `/watch?${params}`;
}
