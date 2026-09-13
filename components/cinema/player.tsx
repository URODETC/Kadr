'use client';
import { useEffect, useRef, useState } from 'react';
import type { Playback } from '@/lib/cinema/types';
import type Shaka from 'shaka-player/dist/shaka-player.ui';
import 'shaka-player/dist/controls.css';
export function Player({data,storageKey,onProgress,onEnded}:{data:Playback;storageKey:string;onProgress:(time:number,duration:number)=>void;onEnded:()=>void}){
 const video=useRef<HTMLVideoElement>(null),container=useRef<HTMLDivElement>(null);
 const [status,setStatus]=useState('Проверяем качество и дорожки…');const [error,setError]=useState('');const [retry,setRetry]=useState(0);
 const callbacks=useRef({onProgress,onEnded});callbacks.current={onProgress,onEnded};
 useEffect(()=>{
  if(!video.current||!container.current)return;
  const element=video.current;let disposed=false;let ui:Shaka.ui.Overlay|undefined;let player:Shaka.Player|undefined;let lastSave=0;
  setError('');setStatus('Проверяем качество и дорожки…');
  const handleTime=()=>{if(element.currentTime-lastSave>=5||element.currentTime<lastSave){lastSave=element.currentTime;callbacks.current.onProgress(element.currentTime,element.duration);}};
  const save=()=>callbacks.current.onProgress(element.currentTime,element.duration);
  const ended=()=>callbacks.current.onEnded();
  element.addEventListener('timeupdate',handleTime);element.addEventListener('pause',save);element.addEventListener('ended',ended);
  const run=async()=>{
   try{
    const mod=await import('shaka-player/dist/shaka-player.ui');const shaka=mod.default;
    if(disposed)return;
    shaka.polyfill.installAll();
    if(!shaka.Player.isBrowserSupported())throw new Error('Этот браузер не поддерживает потоковый плеер. Попробуйте актуальный Chrome, Firefox или Safari.');
    player=new shaka.Player();await player.attach(element);if(disposed){await player.destroy();return;}
    player.configure({preferredAudioLanguage:'ru',preferredTextLanguage:'ru',restrictions:{minWidth:1920},abr:{restrictions:{minWidth:1920}},streaming:{bufferingGoal:20,rebufferingGoal:2,preferNativeHls:false}});
    ui=new shaka.ui.Overlay(player,container.current!,element);
    ui.configure({controlPanelElements:['play_pause','time_and_duration','spacer','mute','volume','overflow_menu','fullscreen'],overflowMenuButtons:['quality','language','captions','playback_rate','picture_in_picture'],trackLabelFormat:shaka.ui.Overlay.TrackLabelFormat.LABEL_OR_LANGUAGE,textTrackLabelFormat:shaka.ui.Overlay.TrackLabelFormat.LABEL_OR_LANGUAGE,seekBarColors:{base:'#ffffff30',buffered:'#ffffff60',played:'#d7ef75'},showUnbufferedStart:false});
    ui.getControls()?.getLocalization()?.changeLocale(['ru']);
    player.addEventListener('error',()=>{if(!disposed){element.pause();setError('Не удалось воспроизвести поток. Возможно, источник недоступен, отсутствует 1080p или браузер не поддерживает кодек.');}});
    let resume=0;try{resume=Number(JSON.parse(localStorage.getItem(storageKey)||'{}').time)||0;}catch{}
    await player.load(data.sources[0].url,resume||undefined,data.sources[0].mime);
    if(disposed)return;
    const variants=player.getVariantTracks();
    if(!variants.some(t=>(t.width??0)>=1920)){await player.unload();throw new Error('У этого источника нет 1080p. Воспроизведение остановлено: качество ниже вашего минимума.');}
    if(!data.demo){
     const tracks=player.getAudioTracks();
     const russian=tracks.filter(t=>/^(ru|rus)(-|$)/i.test(t.language)||/рус/i.test(t.label??''));
     const original=data.audios.find(a=>a.original);
     const hasOriginal=original&&tracks.some(t=>/orig|оригинал/i.test(t.label??'')||(original.lang!=='und'&&t.language===original.lang));
     if(!russian.length||!hasOriginal){await player.unload();throw new Error('В потоке не подтверждены русская и оригинальная дорожки.');}
    }
    let subtitleFailures=0;
    for(const sub of data.subtitles){if(disposed)return;try{await player.addTextTrackAsync(sub.url,sub.lang,'subtitles',sub.mime,undefined,sub.label);}catch{subtitleFailures++;}}
    if(!data.demo&&!player.getTextTracks().length){await player.unload();throw new Error('Субтитры не загрузились. Попробуйте позже.');}
    if(!disposed){const max=Math.max(...variants.map(t=>t.width??0));setStatus(`${max>=3840?'4K':'1080p'} · Озвучки и субтитры — в настройках плеера${subtitleFailures?' · Часть субтитров недоступна':''}`);}
   }catch(e){if(!disposed){element.pause();setError(e instanceof Error?e.message:'У источника нет доступного потока 1080p. Попробуйте другой фильм.');setStatus('');}}
  };
  void run();
  return()=>{disposed=true;save();element.removeEventListener('timeupdate',handleTime);element.removeEventListener('pause',save);element.removeEventListener('ended',ended);void(async()=>{if(ui)await ui.destroy();if(player)await player.destroy();})();};
 },[data,storageKey,retry]);
 return <><div className="player-shell"><div ref={container}><video ref={video} playsInline crossOrigin="anonymous" aria-label="Видеоплеер"/></div></div>{error?<div className="error" role="alert">{error}<div><button className="filter" onClick={()=>setRetry(v=>v+1)}>Повторить</button></div></div>:<p className="player-status" role="status">{status}</p>}</>;
}
