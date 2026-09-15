/** All times are seconds on the selected stream's timeline. */
export type SkipSegment = {kind:'opening'|'ending';start:number;end:number;source:'provider'|'chapter'};
const record=(value:unknown):Record<string,unknown> => value!==null&&typeof value==='object'?value as Record<string,unknown>:{};
export function validSegments(value:unknown,duration=Infinity):SkipSegment[]{
 if(!Array.isArray(value)||duration<=0||Number.isNaN(duration))return [];
 const result:SkipSegment[]=[];
 for(const item of value.slice(0,100)){
  const s=record(item);
  if((s.kind!=='opening'&&s.kind!=='ending')||(s.source!=='provider'&&s.source!=='chapter')||typeof s.start!=='number'||typeof s.end!=='number'||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>duration)continue;
  result.push(s as SkipSegment);
 }
 // Ambiguous, overlapping intervals are unsafe to seek across.
 return result.filter((s,i)=>!result.some((other,j)=>i!==j&&s.start<other.end&&other.start<s.end)).sort((a,b)=>a.start-b.start);
}
export function providerSegments(value:unknown):SkipSegment[]{
 const episode=record(value);
 return validSegments(['opening','ending'].map(kind=>{
  const range=record(episode[kind]);
  return {kind,start:range.start,end:range.stop,source:'provider'};
 }));
}
export function chapterSegments(chapters:unknown):SkipSegment[]{
 if(!Array.isArray(chapters))return [];
 return validSegments(chapters.map(value=>{
  const c=record(value),title=typeof c.title==='string'?c.title.trim():'';
  // Match explicit chapter labels only: "Opening scene" is story, not an OP.
  const kind=/^(opening|op|intro|опенинг|заставка)(\s*\d+)?$/i.test(title)?'opening':/^(ending|ed|outro|end credits|closing credits|credits|эндинг|титры|финальные титры)(\s*\d+)?$/i.test(title)?'ending':undefined;
  return {kind,start:c.startTime,end:c.endTime,source:'chapter'};
 }));
}
export function activeSegment(segments:SkipSegment[],time:number,duration:number){
 if(!Number.isFinite(time)||!Number.isFinite(duration))return undefined;
 return validSegments(segments,duration).find(s=>time>=s.start&&time<s.end);
}
export function mergeSegments(provider:unknown,chapters:unknown):SkipSegment[]{
 const primary=validSegments(provider);
 const fallback=validSegments(chapters).filter(s=>!primary.some(p=>p.kind===s.kind||s.start<p.end&&p.start<s.end));
 return validSegments([...primary,...fallback]);
}
