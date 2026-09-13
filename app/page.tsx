import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {userForToken} from '@/lib/server/auth.mjs';
import Anime from '@/components/anime';
export const dynamic='force-dynamic';
export default async function Home(){const user=userForToken((await cookies()).get('anime_session')?.value) as {id:number;username:string;role:string}|null;if(!user)redirect('/login');return <Anime user={{...user}}/>;}
