import {db} from './auth.mjs';
const MINUTE=60000, DAY=86400000;
let initialized=false,cleaned=0;
function database(now){
 const d=db();
 if(!initialized){d.exec(`CREATE TABLE IF NOT EXISTS activity_meta(started_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS activity_presence(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,seen_at INTEGER NOT NULL,path TEXT NOT NULL,title TEXT NOT NULL,playing INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS activity_minutes(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,bucket INTEGER NOT NULL,playing INTEGER NOT NULL,title TEXT NOT NULL,PRIMARY KEY(user_id,bucket));
 CREATE INDEX IF NOT EXISTS activity_time ON activity_minutes(bucket);`);
 if(!d.prepare('SELECT 1 FROM activity_meta').get())d.prepare('INSERT INTO activity_meta VALUES (?)').run(now);
 initialized=true;}
 if(now-cleaned>DAY){d.prepare('DELETE FROM activity_minutes WHERE bucket<?').run(Math.floor((now-90*DAY)/MINUTE)*MINUTE);d.prepare('DELETE FROM activity_presence WHERE seen_at<?').run(now-90*DAY);cleaned=now;}
 return d;
}
export function recordActivity(userId,input,now=Date.now()){
 if(typeof input.path!=='string'||!/^\/[A-Za-z0-9/_-]*$/.test(input.path)||input.path.length>250||typeof input.playing!=='boolean'||typeof input.title!=='string'||input.title.length>250)return false;
 const d=database(now),title=input.playing?input.title:'';
 d.prepare(`INSERT INTO activity_presence VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET seen_at=excluded.seen_at,path=excluded.path,title=excluded.title,playing=excluded.playing`).run(userId,now,input.path,title,Number(input.playing));
 // One sample per user and minute, including when several tabs/devices are open.
 d.prepare(`INSERT INTO activity_minutes VALUES (?,?,?,?) ON CONFLICT(user_id,bucket) DO UPDATE SET playing=MAX(playing,excluded.playing),title=CASE WHEN excluded.playing=1 THEN excluded.title ELSE title END`).run(userId,Math.floor(now/MINUTE)*MINUTE,Number(input.playing),title);
 return true;
}
export function dashboard(from,to,now=Date.now()){
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to||to-from>90*DAY||from<now-90*DAY-MINUTE||to>now+MINUTE)return null;
 const d=database(now),start=Math.ceil(from/MINUTE)*MINUTE;
 const totals=d.prepare('SELECT COUNT(DISTINCT user_id) AS activeUsers,COUNT(*) AS activeMinutes,COALESCE(SUM(playing),0) AS watchMinutes FROM activity_minutes WHERE bucket>=? AND bucket<?').get(start,to);
 const step=to-from<=2*DAY?3600000:DAY;
 return {from,to,generatedAt:now,startedAt:d.prepare('SELECT started_at FROM activity_meta').get().started_at,
 totals:{...totals,...d.prepare('SELECT COUNT(*) AS totalUsers,SUM(CASE WHEN created_at>=? AND created_at<? THEN 1 ELSE 0 END) AS newUsers FROM users').get(from,to)},
 online:d.prepare('SELECT u.id,u.username,p.seen_at AS seenAt,p.path,p.title,p.playing FROM activity_presence p JOIN users u ON u.id=p.user_id WHERE p.seen_at>? ORDER BY p.playing DESC,p.seen_at DESC').all(now-90000),
 series:d.prepare('SELECT CAST(bucket / ? AS INTEGER)*? AS time,COUNT(DISTINCT user_id) AS users,SUM(playing) AS watchMinutes FROM activity_minutes WHERE bucket>=? AND bucket<? GROUP BY time ORDER BY time').all(step,step,start,to),step,
 titles:d.prepare("SELECT title,COUNT(*) AS minutes,COUNT(DISTINCT user_id) AS users FROM activity_minutes WHERE bucket>=? AND bucket<? AND playing=1 AND title!='' GROUP BY title ORDER BY minutes DESC,title LIMIT 10").all(start,to),
 users:d.prepare('SELECT u.id,u.username,COUNT(*) AS minutes,SUM(a.playing) AS watchMinutes,MAX(a.bucket) AS lastSeen FROM activity_minutes a JOIN users u ON u.id=a.user_id WHERE a.bucket>=? AND a.bucket<? GROUP BY u.id ORDER BY minutes DESC,u.username LIMIT 100').all(start,to)};
}
