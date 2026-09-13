import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createUser} from '/app/lib/server/auth.mjs';
const password=randomBytes(24).toString('hex');await createUser('smoke_admin',password,'admin');
const child=spawn(process.execPath,['server.js'],{stdio:['ignore','ignore','inherit']});
const base='http://127.0.0.1:3000';
try{
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/login')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}assert.ok(ready);
 assert.equal((await fetch(base+'/api/anime')).status,401);
 const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'smoke_admin',password})});assert.equal(r.status,200);
 const headers={Cookie:r.headers.get('set-cookie').split(';')[0]};
 assert.equal((await fetch(base+'/',{headers})).status,200);assert.equal((await fetch(base+'/admin',{headers})).status,200);
 assert.equal((await(await fetch(base+'/api/users',{headers})).json())[0].username,'smoke_admin');
 if(process.env.EXTRACTOR_URL){
  const providers=await fetch(base+'/api/extractor/providers',{headers});assert.equal(providers.status,200);
  const data=await providers.json();assert.ok(data.items.some(p=>p.id==='yummy_anime'));
  assert.equal((await fetch(base+'/api/extractor/providers')).status,401);
  console.log('Docker extractor: authenticated bridge to private Python service passed.');
 }
 console.log('Docker runtime: login, SQLite, authenticated pages and admin API passed.');
}finally{child.kill('SIGTERM');}
