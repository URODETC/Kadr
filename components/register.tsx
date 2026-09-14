'use client';
import {useEffect,useState} from 'react';
export default function Register(){
 const [token,setToken]=useState(''),[valid,setValid]=useState(false),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();const value=new URLSearchParams(location.hash.slice(1)).get('token')||'';setToken(value);
  if(!/^[a-f0-9]{64}$/.test(value)){setError('Для регистрации нужна ссылка-приглашение.');setChecking(false);return;}
  fetch('/api/auth/invitation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:value}),signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setValid(true);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setChecking(false);});return()=>c.abort();
 },[]);
 return <main className="login-screen"><form className="login-card" onSubmit={async e=>{e.preventDefault();const data=new FormData(e.currentTarget);setError('');if(data.get('password')!==data.get('confirm')){setError('Пароли не совпадают.');return;}setBusy(true);try{const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,username:data.get('username'),password:data.get('password')})});const d=await r.json();if(!r.ok){if(r.status===410)setValid(false);throw new Error(d.error);}location.replace('/');}catch(e){setError(e instanceof Error?e.message:'Ошибка подключения');setBusy(false);}}}>
 <div className="brand">кадр<span> / anime</span></div><p>{checking?'Проверяем приглашение…':valid?'Выберите логин и пароль.':'Вход по приглашению'}</p>
 {valid&&<><label>Логин<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required pattern="[A-Za-z0-9_]{3,32}" minLength={3} maxLength={32} title="3–32 латинские буквы, цифры или _"/></label><label>Пароль<input name="password" type="password" required minLength={6} maxLength={128} autoComplete="new-password" placeholder="Не менее 6 символов"/></label><label>Повторите пароль<input name="confirm" type="password" required minLength={6} maxLength={128} autoComplete="new-password"/></label><button className="primary" disabled={busy}>{busy?'Создаём аккаунт…':'Зарегистрироваться'}</button></>}
 {error&&<p role="alert" className="error">{error}</p>}<a href="/login">Уже есть аккаунт? Войти</a></form></main>;
}
