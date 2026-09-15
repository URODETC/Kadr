'use client';
import {useEffect} from 'react';
export default function ActivityTracker(){
 useEffect(()=>{
  let pending=false,last=0;
  async function ping(){
   const path=location.pathname;
   if(['/login','/register'].includes(path)||pending||Date.now()-last<5000)return;
   const video=document.querySelector<HTMLVideoElement>('video[data-activity-title]');
   const playing=!!video&&!video.paused&&!video.ended&&video.readyState>=3;
   if(document.visibilityState!=='visible'&&!playing)return;
   pending=true;last=Date.now();
   try{await fetch('/api/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,playing,title:playing?(video?.dataset.activityTitle||'').slice(0,250):''})});}catch{}finally{pending=false;}
  }
  void ping();const timer=setInterval(()=>void ping(),30000);
  document.addEventListener('visibilitychange',ping);document.addEventListener('playing',ping,true);document.addEventListener('pause',ping,true);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',ping);document.removeEventListener('playing',ping,true);document.removeEventListener('pause',ping,true);};
 },[]);
 return null;
}
