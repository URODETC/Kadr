import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
let child,dir,base,adminCookie,friendCookie,extractorMock,extractorOwner;
const password='private-test-password-42';
async function req(path,{method='GET',cookie,body,origin=base}={}){
 return fetch(base+path,{method,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json',Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'anime-auth-'));process.env.DATABASE_PATH=join(dir,'test.sqlite');
 const {createUser}=await import('../lib/server/auth.mjs');await createUser('owner',password,'admin');
 const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});base=`http://127.0.0.1:${port}`;
 extractorMock=createHttpServer((req,res)=>{extractorOwner=req.headers['x-user-id'];res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:[{id:'animego',title:'AnimeGO'}]}));});
 await new Promise(r=>extractorMock.listen(0,'127.0.0.1',r));
 const extractorURL=`http://127.0.0.1:${extractorMock.address().port}`;
 child=spawn(process.execPath,['.next/standalone/server.js'],{env:{...process.env,APP_ORIGIN:base,EXTRACTOR_URL:extractorURL,COOKIE_SECURE:'false',HOSTNAME:'127.0.0.1',PORT:String(port)},stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',chunk=>process.stderr.write(chunk));
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}assert.ok(ready,'production server ready');
});
after(async()=>{if(child){if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}}if(extractorMock)await new Promise(r=>extractorMock.close(r));await rm(dir,{recursive:true,force:true});});
test('anonymous users see only login; forged auth headers do not help',async()=>{
 for(const path of ['/','/admin','/credits']){const r=await req(path);assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location'),base).pathname,'/login');}
 for(const path of ['/api/anime','/api/anime/10292','/api/users','/api/auth/me','/api/catalog','/api/progress','/api/extractor/providers','/api/extractor/search/animego'])assert.equal((await req(path)).status,401);
 const fake=await fetch(base+'/api/users',{headers:{'oai-authenticated-user-id':'admin',Cookie:'anime_session='+'a'.repeat(64)}});assert.equal(fake.status,401);
 const login=await(await req('/login')).text();assert.ok(!login.includes('История о перекуре'));
});
test('login rejects cross-origin and incorrect credentials; session cookie is httpOnly',async()=>{
 assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'owner',password},origin:'https://evil.example'})).status,403);
 assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'owner',password:'wrong'}})).status,401);
 const r=await req('/api/auth/login',{method:'POST',body:{username:'OWNER',password}});assert.equal(r.status,200);const c=r.headers.get('set-cookie');assert.match(c,/HttpOnly/);assert.match(c,/SameSite=Strict/);adminCookie=c.split(';')[0];assert.equal((await req('/',{cookie:adminCookie})).status,200);
});
test('only admin creates accounts and supplied role is ignored',async()=>{
 let r=await req('/api/users',{method:'POST',cookie:adminCookie,body:{username:'friend',password,role:'admin'}});assert.equal(r.status,201);
 r=await req('/api/auth/login',{method:'POST',body:{username:'friend',password}});assert.equal(r.status,200);friendCookie=r.headers.get('set-cookie').split(';')[0];
 assert.equal((await(await req('/api/auth/me',{cookie:friendCookie})).json()).role,'user');
 assert.equal((await req('/api/users',{cookie:friendCookie})).status,403);
 assert.equal((await req('/api/users',{method:'POST',cookie:friendCookie,body:{username:'intruder',password}})).status,403);
 assert.equal((await req('/admin',{cookie:friendCookie})).status,307);
 assert.equal((await req('/api/users',{method:'POST',cookie:adminCookie,body:{username:'friend',password}})).status,409);
});
test('extractor bridge validates routes and forwards server-owned identity',async()=>{
 const r=await fetch(base+'/api/extractor/providers',{headers:{Cookie:friendCookie,'X-User-Id':'999'}});
 assert.equal(r.status,200);assert.equal((await r.json()).items[0].id,'animego');
 const me=await(await req('/api/auth/me',{cookie:friendCookie})).json();assert.equal(extractorOwner,String(me.id));
 assert.equal((await req('/api/extractor/search/unknown',{cookie:friendCookie})).status,404);
 assert.equal((await req('/api/extractor/playback/https%3A%2F%2Flocalhost',{cookie:friendCookie})).status,404);
});
test('server progress is private, survives another session, and rejects stale writes',async()=>{
 const value={titleKey:'yummy_anime:abc',episodeKey:'1',provider:'yummy_anime',episode:1,title:'Test anime',poster:'',position:123.9,duration:1200,revision:0};
 let r=await req('/api/progress',{method:'POST',cookie:friendCookie,body:{...value,userId:1}});assert.equal(r.status,200);let row=(await r.json()).item;assert.equal(row.position,123);assert.equal(row.revision,1);assert.equal(row.watched,false);
 assert.equal((await(await req('/api/progress',{cookie:adminCookie})).json()).items.length,0);
 const second=await req('/api/auth/login',{method:'POST',body:{username:'friend',password}});const secondCookie=second.headers.get('set-cookie').split(';')[0];
 row=(await(await req('/api/progress?title=yummy_anime:abc',{cookie:secondCookie})).json()).items[0];assert.equal(row.position,123);
 r=await req('/api/progress',{method:'POST',cookie:secondCookie,body:{...value,revision:1,position:600}});assert.equal(r.status,200);
 assert.equal((await req('/api/progress',{method:'POST',cookie:friendCookie,body:{...value,revision:1,position:130}})).status,409);
 row=(await(await req('/api/progress',{cookie:secondCookie})).json()).items[0];assert.equal(row.position,600);
 r=await req('/api/progress',{method:'POST',cookie:secondCookie,body:{...value,revision:2,position:1190}});assert.equal((await r.json()).item.watched,true);
 r=await req('/api/progress',{method:'POST',cookie:secondCookie,body:{...value,revision:3,position:0,state:'unwatched'}});assert.equal((await r.json()).item.watched,false);
 assert.equal((await req('/api/progress',{method:'POST',cookie:friendCookie,body:{...value,position:-1}})).status,400);
 assert.equal((await req('/api/progress',{method:'POST',cookie:friendCookie,body:{...value,duration:0}})).status,400);
 assert.equal((await req('/api/progress',{method:'POST',cookie:friendCookie,origin:'https://evil.example',body:value})).status,403);
});
test('password reset and deletion revoke active sessions',async()=>{
 const users=await(await req('/api/users',{cookie:adminCookie})).json();const friend=users.find(u=>u.username==='friend');
 assert.equal((await req('/api/users',{method:'PATCH',cookie:adminCookie,body:{id:friend.id,password:password+'new'}})).status,200);
 assert.equal((await req('/api/auth/me',{cookie:friendCookie})).status,401);
 const r=await req('/api/auth/login',{method:'POST',body:{username:'friend',password:password+'new'}});friendCookie=r.headers.get('set-cookie').split(';')[0];
 assert.equal((await req('/api/users',{method:'DELETE',cookie:adminCookie,body:{id:friend.id}})).status,200);
 assert.equal((await req('/api/auth/me',{cookie:friendCookie})).status,401);
 const owner=users.find(u=>u.role==='admin');assert.equal((await req('/api/users',{method:'DELETE',cookie:adminCookie,body:{id:owner.id}})).status,403);
});
test('expiry, rate limiting, logout and secure cookie default',async()=>{
 const auth=await import('../lib/server/auth.mjs');const token=auth.newSession(1);auth.db().prepare('UPDATE sessions SET expires=0 WHERE hash=?').run((await import('node:crypto')).createHash('sha256').update(token).digest('hex'));assert.equal(auth.userForToken(token),null);assert.match(auth.cookie('a'),/Secure/);
 for(let i=0;i<10;i++)assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'missing',password:'wrong'}})).status,401);
 assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'missing',password:'wrong'}})).status,429);
 assert.equal((await req('/api/auth/logout',{method:'POST',cookie:adminCookie,body:{}})).status,200);
 assert.equal((await req('/api/auth/me',{cookie:adminCookie})).status,401);
});
