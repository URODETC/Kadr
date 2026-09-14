import {createInvitation,listInvitations,revokeInvitation,checkInvitation,acceptInvitation} from '@/lib/server/invitations.mjs';
import {readProgress,writeProgress} from '@/lib/server/progress';
import { currentUser, sameOrigin, db, allowAttempt, verifyPassword, newSession, cookie, removeSession, hashPassword } from '@/lib/server/auth.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',...headers}});
async function handle(request:Request){
 const url=new URL(request.url),path=url.pathname.slice(5),method=request.method;
 try{
  if(method!=='GET'&&!sameOrigin(request))return json({error:'Недопустимый источник запроса.'},403);
  let body:Record<string,unknown>={};
  if(method!=='GET'){
   const reader=request.body?.getReader();let text='';let size=0;const decoder=new TextDecoder();
   if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4096){await reader.cancel();return json({error:'Запрос слишком большой.'},413);}text+=decoder.decode(chunk.value,{stream:true});}
   text+=decoder.decode();
   try{body=JSON.parse(text||'{}');if(!body||Array.isArray(body)||typeof body!=='object')throw new Error();}catch{return json({error:'Неверный формат запроса.'},400);}
  }
  if(path==='auth/login'&&method==='POST'){
   if(!allowAttempt('global-login',100))return json({error:'Слишком много попыток. Попробуйте через 15 минут.'},429);
   const name=typeof body.username==='string'?body.username.toLowerCase().slice(0,32):'';
   if(!allowAttempt('login:'+name))return json({error:'Слишком много попыток. Попробуйте через 15 минут.'},429);
   const row=db().prepare('SELECT * FROM users WHERE username=?').get(name) as {id:number;password:string}|undefined;
   const dummy='00000000000000000000000000000000:'+ '00'.repeat(64);
   const valid=await verifyPassword(body.password,row?.password||dummy);
   if(!row||!valid)return json({error:'Неверный логин или пароль.'},401);
   db().prepare('DELETE FROM attempts WHERE key=?').run('login:'+name);
   return json({ok:true},200,{'Set-Cookie':cookie(newSession(row.id))});
  }
  if((path==='auth/invitation'||path==='auth/register')&&method==='POST'){
   if(!allowAttempt('global-'+path,100))return json({error:'Слишком много попыток. Попробуйте через 15 минут.'},429);
   const invite=checkInvitation(body.token);
   if(!invite)return json({error:'Приглашение недействительно, истекло или уже использовано.'},410);
   if(path==='auth/invitation')return json({expiresAt:invite.expires_at});
   const session=await acceptInvitation(body.token,body.username,body.password);
   if(!session)return json({error:'Приглашение недействительно, истекло или уже использовано.'},410);
   return json({ok:true},201,{'Set-Cookie':cookie(session)});
  }
  const user=currentUser(request) as {id:number;username:string;role:string}|null;
  if(!user)return json({error:'Требуется вход.'},401);
  if(path==='progress'){
   if(method==='GET'){const result=readProgress(user.id,url.searchParams.get('title'));return json(result,'status' in result?result.status:200);}
   if(method==='POST'){const result=writeProgress(user.id,body);return json(result,result.status);}
  }
  if(method==='GET' && path.startsWith('extractor/')){
   const subpath=path.slice('extractor/'.length);
   if(!/^(providers|search\/(anilibria|animego|yummy_anime|anilibme|animevost|sameband|dreamcast)|(anime|sources|playback)\/[A-Za-z0-9_-]{32})$/.test(subpath))return json({error:'Неизвестный запрос экстрактора.'},404);
   if(!allowAttempt('extractor:'+user.id,180))return json({error:'Слишком много запросов. Подождите несколько минут.'},429);
   const endpoint=new URL(subpath, (process.env.EXTRACTOR_URL||'http://127.0.0.1:8000').replace(/\/?$/, '/'));
   if(subpath.startsWith('search/'))endpoint.searchParams.set('q',(url.searchParams.get('q')||'').slice(0,100));
   try{
    const upstream=await fetch(endpoint,{headers:{'X-User-Id':String(user.id)},signal:AbortSignal.timeout(40000),cache:'no-store'});
    const result=await upstream.json();
    return upstream.ok?json(result):json({error:typeof result.detail==='string'?result.detail:'Ошибка экстрактора.'},upstream.status);
   }catch{return json({error:'Сервис экстрактора недоступен. Проверьте его запуск или выберите каталог AniLiberty.'},502);}
  }
  if(path==='auth/me'&&method==='GET')return json(user);
  if(path==='auth/logout'&&method==='POST'){removeSession(request);return json({ok:true},200,{'Set-Cookie':cookie('',0)});}
  if(path==='invitations'){
   if(user.role!=='admin')return json({error:'Доступ только для суперадминистратора.'},403);
   if(method==='GET')return json(listInvitations());
   if(method==='POST'){
    if(!allowAttempt('invite-create:'+user.id,20))return json({error:'Слишком много приглашений. Попробуйте через 15 минут.'},429);
    const invite=createInvitation(user.id);
    return json({id:invite.id,expiresAt:invite.expiresAt,url:new URL('/register',process.env.APP_ORIGIN).href+'#token='+invite.token},201);
   }
   if(method==='DELETE'){
    const id=Number(body.id);
    if(!Number.isSafeInteger(id)||id<1)return json({error:'Неверное приглашение.'},400);
    return revokeInvitation(id)?json({ok:true}):json({error:'Приглашение уже использовано или отозвано.'},409);
   }
   return json({error:'Метод недоступен.'},405);
  }
  if(path==='users'){
   if(user.role!=='admin')return json({error:'Доступ только для суперадминистратора.'},403);
   if(method==='GET')return json(db().prepare('SELECT id,username,role,created_at FROM users ORDER BY id').all());
   if(method==='POST')return json({error:'Создайте ссылку-приглашение.'},405);
   const id=Number(body.id);
   const target=db().prepare('SELECT id,role FROM users WHERE id=?').get(id);
   if(!target)return json({error:'Пользователь не найден.'},404);
   if(target.role==='admin')return json({error:'Суперадминистратор управляется через консоль сервера.'},403);
   if(method==='DELETE'){db().prepare('DELETE FROM users WHERE id=?').run(id);return json({ok:true});}
   if(method==='PATCH'){const hash=await hashPassword(body.password,'user');db().exec('BEGIN IMMEDIATE');try{db().prepare('UPDATE users SET password=? WHERE id=?').run(hash,id);db().prepare('DELETE FROM sessions WHERE user_id=?').run(id);db().exec('COMMIT');}catch(e){db().exec('ROLLBACK');throw e;}return json({ok:true});}
  }
  if(method==='GET'&&(path==='anime'||/^anime\/\d+$/.test(path))){
   let route='';
   if(path==='anime'){
    const query=(url.searchParams.get('q')||'').slice(0,100),page=Math.min(1000,Math.max(1,Number(url.searchParams.get('page'))||1));
    route=query?`/anime/catalog/releases?limit=24&page=${page}&f[search]=${encodeURIComponent(query)}`:`/anime/catalog/releases?limit=24&page=${page}`;
   }else route='/anime/releases/'+path.split('/')[1];
   const upstream=await fetch('https://anilibria.top/api/v1'+route,{signal:AbortSignal.timeout(12000),cache:'no-store',headers:{Accept:'application/json'}});
   if(!upstream.ok)return json({error:'Источник аниме временно недоступен. Попробуйте позже.'},502);
   return json(await upstream.json());
  }
  return json({error:'Не найдено.'},404);
 }catch(error){
  const message=error instanceof Error?error.message:'';
  if(message.includes('UNIQUE'))return json({error:'Этот логин уже занят.'},409);
  if(message.startsWith('Логин:')||message.startsWith('Пароль должен'))return json({error:message},400);
  return json({error:'Не удалось выполнить запрос.'},500);
 }
}
export const GET=handle,POST=handle,PATCH=handle,DELETE=handle;
