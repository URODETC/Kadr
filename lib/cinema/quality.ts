// Choose by resolution first, then by bitrate within the same resolution.
export function highestVideoTrack<T extends {height: number | null; width: number | null; bandwidth: number}>(tracks: T[]): T | undefined {
 return [...tracks].sort((a,b)=>(b.height||0)-(a.height||0)||(b.width||0)-(a.width||0)||b.bandwidth-a.bandwidth)[0];
}

export function highestSourceIndex(sources: {quality: number}[]): number {
 return sources.reduce((best,source,index)=>source.quality>sources[best].quality?index:best,0);
}
