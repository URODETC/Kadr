import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {userForToken} from '@/lib/server/auth.mjs';
import Admin from '@/components/admin';
export const dynamic='force-dynamic';
export default async function Page(){const user=userForToken((await cookies()).get('anime_session')?.value) as {role:string}|null;if(!user)redirect('/login');if(user.role!=='admin')redirect('/');return <Admin/>;}
