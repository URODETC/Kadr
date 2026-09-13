import JSON5 from 'json5';
import { z } from 'zod';
import { catalog } from './catalog';
import type { Detail, Playback, Title } from './types';

export class SourceError extends Error { constructor(message:string,public status=502){super(message);} }
const safeUrl = z.string().url().refine(s=>{const u=new URL(s); return u.protocol==='https:'&&!u.username&&!u.password;});
const mediaSchema = z.object({hls:safeUrl.optional(),dash:safeUrl.optional(),audio:z.object({names:z.array(z.string()).max(100)}).passthrough().optional(),cc:z.array(z.object({url:safeUrl,name:z.string()})).max(100).optional(),title:z.string().optional(),episode:z.union([z.string(),z.number()]).optional()}).passthrough();
const playlistSchema=z.object({seasons:z.array(z.object({season:z.union([z.string(),z.number()]),episodes:z.array(mediaSchema).max(2000)})).max(200)});

// Only parse literal fields we need. Never execute provider JavaScript (including P2P callbacks).
export function literalField(text:string,key:string):unknown {
 const match=new RegExp('(?:^|[,\\s])["\']?'+key+'["\']?\\s*:\\s*').exec(text);
 if(!match)return undefined;
 const start=match.index+match[0].length;let quote='',escape=false,depth=0;
 for(let i=start;i<text.length;i++){
  const c=text[i];
  if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='{'||c==='[')depth++;
  if(c==='}'||c===']'){if(depth===0)return JSON5.parse(text.slice(start,i));depth--;if(depth===0)return JSON5.parse(text.slice(start,i+1));}
  if(c===','&&depth===0)return JSON5.parse(text.slice(start,i));
 }
 return undefined;
}
export async function fetchConfig(id:string,signal?:AbortSignal){
 if(!/^\d{1,10}$/.test(id))throw new SourceError('Некорректный идентификатор фильма.',400);
 let response:Response;
 try{response=await fetch(`https://api.delivembd.ws/embed/kp/${id}`,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),cache:'no-store',redirect:'manual',headers:{'Accept':'text/html'}});}catch{throw new SourceError('Источник не отвечает. Попробуйте позже.');}
 if(!response.ok)throw new SourceError('Источник временно недоступен.');
 if(Number(response.headers.get('content-length')||0)>4_000_000)throw new SourceError('Ответ источника слишком большой.');
 const html=await response.text();
 if(html.length>4_000_000)throw new SourceError('Ответ источника слишком большой.');
 const begin=html.search(/makePlayer\(\s*\{/);
 if(begin<0)throw new SourceError('Видео не найдено у бесплатного источника.',404);
 const body=html.slice(begin).replace(/^makePlayer\(\s*\{/,'');
 try{
  if(literalField(body,'blocked')===true)throw new SourceError('Источник ограничил доступ к этому видео.',403);
  const source=literalField(body,'source');const playlist=literalField(body,'playlist');const title=literalField(body,'title');
  return {title:typeof title==='string'?title:undefined,source:source?mediaSchema.parse(source):undefined,playlist:playlist?playlistSchema.parse(playlist):undefined};
 }catch(e){if(e instanceof SourceError)throw e;throw new SourceError('Формат ответа источника изменился.');}
}
export function getTitle(id:string):Title|undefined{return catalog.find(x=>x.id===id);}
export async function detail(id:string,signal?:AbortSignal):Promise<Detail>{
 const known=getTitle(id);
 if(known?.demo)return {item:known,episodes:[{key:'0:1',season:0,number:1,title:known.title}]};
 const data=await fetchConfig(id,signal);
 const item=known??{id,title:data.title??`Кинопоиск #${id}`,original:'',type:data.playlist?'serial':'movie',year:0,genre:'',plot:'Информация получена от видеопровайдера.',poster:'',quality:0};
 const episodes=data.playlist?.seasons.flatMap(s=>s.episodes.map((e,i)=>({key:`${Number(s.season)}:${Number(e.episode)||i+1}`,season:Number(s.season),number:Number(e.episode)||i+1,title:e.title||`Серия ${i+1}`})))??[{key:'0:1',season:0,number:1,title:item.title}];
 episodes.sort((a,b)=>a.season-b.season||a.number-b.number);
 return {item,episodes};
}
export async function playback(id:string,season:number,episode:number,signal?:AbortSignal):Promise<Playback>{
 if(id==='demo-sintel')return {sources:[{url:'https://storage.googleapis.com/shaka-demo-assets/sintel-mp4-only/dash.mpd',quality:2160,mime:'application/dash+xml'}],audios:[],subtitles:[],demo:true};
 const data=await fetchConfig(id,signal);
 const source=data.playlist?data.playlist.seasons.find(s=>Number(s.season)===season)?.episodes.find((e,i)=>(Number(e.episode)||i+1)===episode):data.source;
 if(!source)throw new SourceError('Эта серия не найдена.',404);
 const audios=(source.audio?.names??[]).map(label=>({label,lang:/рус|дубл|lostfilm|jaskier|tvshows|кубик|омикрон/i.test(label)?'ru':/eng/i.test(label)?'en':/ger|deu/i.test(label)?'de':'und',original:/orig|оригинал/i.test(label)}));
 const subtitles=(source.cc??[]).map(s=>({url:s.url,label:s.name,lang:/рус/i.test(s.name)?'ru':/eng/i.test(s.name)?'en':/укр/i.test(s.name)?'uk':'und',mime:/\.srt(?:[?#]|$)/i.test(s.url)?'application/x-subrip':'text/vtt',shift:0}));
 if(!audios.some(a=>a.lang==='ru'))throw new SourceError('У источника нет подтверждённой русской озвучки.',422);
 if(!audios.some(a=>a.original))throw new SourceError('У источника нет подтверждённой оригинальной дорожки.',422);
 if(data.playlist&&audios.filter(a=>!a.original&&!/укр|eng|ger|deu/i.test(a.label)).length<2)throw new SourceError('Для этой серии не подтверждено несколько русских озвучек.',422);
 if(!subtitles.length)throw new SourceError('У источника нет субтитров для этой серии.',422);
 if(!source.hls)throw new SourceError('Источник не предоставил HLS-поток.',422);
 // Resolution is checked in the browser against actual manifest variants, never this catalogue field.
 return {sources:[{url:source.hls,quality:0,mime:'application/x-mpegURL'}],subtitles,audios};
}
export function failure(error:unknown){return Response.json({error:error instanceof SourceError?error.message:'Не удалось получить данные. Попробуйте ещё раз.'},{status:error instanceof SourceError?error.status:500,headers:{'Cache-Control':'no-store'}});}
