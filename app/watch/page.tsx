import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {userForToken} from '@/lib/server/auth.mjs';
import Anime from '@/components/anime';
export const dynamic='force-dynamic';
export default async function Watch({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=userForToken((await cookies()).get('anime_session')?.value) as {id:number;username:string;role:string}|null;
 if(!user)redirect('/login');
 const params=await searchParams;
 const value=(key:string)=>typeof params[key]==='string'?params[key] as string:'';
 if(!value('provider')||!value('id'))redirect('/');
 return <Anime key={`${value('provider')}:${value('id')}`} user={{...user}} watchPage={{provider:value('provider'),id:value('id'),key:value('key'),title:value('title'),poster:value('poster')}}/>;
}
