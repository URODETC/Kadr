import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'activity-'));
process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {db}=await import('../lib/server/auth.mjs');
const {recordActivity,dashboard}=await import('../lib/server/activity.mjs');
const now=Math.floor(Date.now()/60000)*60000;
db().prepare('INSERT INTO users VALUES (1,?,?,?,?)').run('member','unused','user',now-86400000);
after(()=>{db().close();rmSync(dir,{recursive:true,force:true});});
test('presence expires and minute samples deduplicate devices without erasing playback',()=>{
 assert.equal(recordActivity(1,{path:'/',playing:false,title:''},now),true);
 recordActivity(1,{path:'/watch/1',playing:true,title:'Anime'},now+10000);
 recordActivity(1,{path:'/',playing:false,title:''},now+20000);
 let result=dashboard(now,now+30000,now+30000);
 assert.equal(result.totals.activeUsers,1);assert.equal(result.totals.activeMinutes,1);assert.equal(result.totals.watchMinutes,1);
 assert.equal(result.titles[0].title,'Anime');assert.equal(result.online.length,1);
 result=dashboard(now,now+120000,now+120000);assert.equal(result.online.length,0);
});
test('period is half-open and does not leak samples from outside selected minutes',()=>{
 recordActivity(1,{path:'/',playing:false,title:''},now+60000);
 assert.equal(dashboard(now,now+60000,now+60000).totals.activeMinutes,1);
 assert.equal(dashboard(now+60000,now+120000,now+120000).totals.watchMinutes,0);
 assert.equal(dashboard(now+1,now+60000,now+60000).totals.activeMinutes,0);
 assert.equal(dashboard(now,now,now),null);
 assert.equal(dashboard(NaN,now,now),null);
 assert.equal(dashboard(now-91*86400000,now,now),null);
 assert.equal(recordActivity(1,{path:'/register#secret',playing:false,title:''},now),false);
});
test('deleting a user cascades all activity',()=>{
 db().prepare('DELETE FROM users WHERE id=1').run();
 assert.equal(dashboard(now,now+120000,now+120000).totals.activeUsers,0);
 assert.equal(db().prepare('SELECT COUNT(*) AS n FROM activity_presence').get().n,0);
});
