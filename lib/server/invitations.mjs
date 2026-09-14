import {randomBytes,createHash} from 'node:crypto';
import {db,username,hashPassword,newSession} from './auth.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const validToken=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function database(){
 const d=db();
 d.exec(`CREATE TABLE IF NOT EXISTS invitations(
  id INTEGER PRIMARY KEY,hash TEXT NOT NULL UNIQUE,created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER,revoked_at INTEGER,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL
 );`);
 return d;
}
export function createInvitation(adminId){
 const d=database(),token=randomBytes(32).toString('hex'),now=Date.now(),expiresAt=now+7*86400000;
 const result=d.prepare('INSERT INTO invitations(hash,created_by,created_at,expires_at) VALUES (?,?,?,?)').run(digest(token),adminId,now,expiresAt);
 return {id:Number(result.lastInsertRowid),token,expiresAt};
}
export function listInvitations(){
 return database().prepare(`SELECT invitations.id,invitations.created_at,expires_at,used_at,revoked_at,users.username AS used_by
 FROM invitations LEFT JOIN users ON users.id=invitations.used_by ORDER BY invitations.id DESC LIMIT 100`).all();
}
export function revokeInvitation(id){
 return database().prepare('UPDATE invitations SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL').run(Date.now(),id).changes>0;
}
export function checkInvitation(token){
 if(!validToken(token))return null;
 return database().prepare('SELECT id,expires_at FROM invitations WHERE hash=? AND expires_at>? AND used_at IS NULL AND revoked_at IS NULL').get(digest(token),Date.now())||null;
}
export async function acceptInvitation(token,name,password){
 if(!checkInvitation(token))return null;
 const normalized=username(name),hash=await hashPassword(password,'user'),d=database();
 // Recheck after scrypt: another request may have consumed or revoked this invite.
 d.exec('BEGIN IMMEDIATE');
 try{
  const invitation=checkInvitation(token);
  if(!invitation){d.exec('ROLLBACK');return null;}
  const now=Date.now();
  const userId=d.prepare("INSERT INTO users(username,password,role,created_at) VALUES (?,?,'user',?)").run(normalized,hash,now).lastInsertRowid;
  d.prepare('UPDATE invitations SET used_at=?,used_by=? WHERE id=?').run(now,userId,invitation.id);
  const session=newSession(userId);
  d.exec('COMMIT');
  return session;
 }catch(error){d.exec('ROLLBACK');throw error;}
}
