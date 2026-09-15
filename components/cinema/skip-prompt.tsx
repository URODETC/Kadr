'use client';
import {useEffect,useState,type RefObject} from 'react';
import {activeSegment,type SkipSegment} from '@/lib/cinema/segments';

type Props={video:RefObject<HTMLVideoElement|null>;segments:SkipSegment[];hidden:boolean;onSkip:(time:number)=>void;onNext?:()=>void};
export function SkipPrompt({video,segments,hidden,onSkip,onNext}:Props){
 const [position,setPosition]=useState({time:0,duration:0});
 const [dismissed,setDismissed]=useState<string[]>([]);
 useEffect(()=>{
  const element=video.current;if(!element)return;
  const update=()=>setPosition({time:element.currentTime,duration:element.duration});
  update();
  const events=['timeupdate','seeked','durationchange','loadedmetadata','emptied'];
  events.forEach(event=>element.addEventListener(event,update));
  return()=>events.forEach(event=>element.removeEventListener(event,update));
 },[video]);
 const segment=activeSegment(segments,position.time,position.duration);
 const id=segment?`${segment.kind}:${segment.start}:${segment.end}`:'';
 if(hidden||!segment||dismissed.includes(id))return null;
 const skip=()=>{
  const element=video.current;if(!element)return;
  // Recheck after a seek or source change instead of using a stale rendered prompt.
  const current=activeSegment(segments,element.currentTime,element.duration);
  if(!current||current!==segment)return;
  onSkip(current.end);
 };
 return <div className="watch-skip" role="group" aria-label={segment.kind==='opening'?'Опенинг':'Финальные титры'} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
  <button onClick={skip}>{segment.kind==='opening'?'Пропустить опенинг':'Пропустить титры'}</button>
  {segment.kind==='ending'&&onNext&&<button className="primary" onClick={()=>{
   const element=video.current;
   if(element&&activeSegment(segments,element.currentTime,element.duration)===segment)onNext();
  }}>Следующая серия →</button>}
  <button className="watch-skip-dismiss" aria-label="Скрыть предложение пропуска" onClick={()=>setDismissed(values=>[...values,id])}>×</button>
 </div>;
}
