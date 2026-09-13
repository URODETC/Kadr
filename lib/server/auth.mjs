import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
let database;
export function db() {
 if (database) return database;
 const path=resolve(process.env.DATABASE_PATH || 'data/anime.sqlite');
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 database=new DatabaseSync(path);
 database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
 return database;
}
export function username(value) {
 if(typeof value!=='string'||! /^[a-zA-Z0-9_]{3,32}$/.test(value)) throw new Error('Логин: 3–32 латинские буквы, цифры или _.');
 return value.toLowerCase();
}
export async function hashPassword(value) {
 if(typeof value!=='string'||value.length<12||value.length>128) throw new Error('Пароль должен содержать от 12 до 128 символов.');
 const salt=randomBytes(16).toString('hex');
 const hash=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(value,encoded) {
 if(typeof value!=='string'||value.length>128)return false;
 const [salt,hash]=encoded.split(':');
 const result=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const expected=Buffer.from(hash,'hex');
 return result.length===expected.length&&timingSafeEqual(result,expected);
}
const digest=(value)=>createHash('sha256').update(value).digest('hex');
export function tokenFrom(request) {
 const match=(request.headers.get('cookie')||'').match(/(?:^|;\s*)anime_session=([a-f0-9]{64})(?:;|$)/);
 return match?.[1];
}
export function userForToken(token) {
 if(!token||! /^[a-f0-9]{64}$/.test(token))return null;
 return db().prepare('SELECT users.id,username,role FROM sessions JOIN users ON users.id=sessions.user_id WHERE hash=? AND expires>?').get(digest(token),Date.now())||null;
}
export function currentUser(request){return userForToken(tokenFrom(request));}
export function newSession(id) {
 db().prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
 const token=randomBytes(32).toString('hex');
 db().prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token),id,Date.now()+7*86400000);
 return token;
}
export function removeSession(request){const token=tokenFrom(request);if(token)db().prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));}
export function cookie(token,maxAge=604800){
 const secure=process.env.COOKIE_SECURE!=='false';
 return `anime_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
export function sameOrigin(request){
 const origin=process.env.APP_ORIGIN;
 if(!origin)throw new Error('APP_ORIGIN не настроен на сервере.');
 return request.headers.get('origin')===new URL(origin).origin;
}
export function allowAttempt(key,max=10) {
 const now=Date.now();
 db().prepare('DELETE FROM attempts WHERE expires<=?').run(now);
 db().prepare('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+15*60000);
 return db().prepare('SELECT count FROM attempts WHERE key=?').get(key).count<=max;
}
export async function createUser(name,password,role='user') {
 const normalized=username(name),hash=await hashPassword(password);
 return db().prepare('INSERT INTO users(username,password,role,created_at) VALUES (?,?,?,?)').run(normalized,hash,role,Date.now()).lastInsertRowid;
}
