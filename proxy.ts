import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from './lib/server/auth.mjs';
export function proxy(request: NextRequest) {
 const path=request.nextUrl.pathname;
 if(path==='/login'||path==='/api/auth/login'||path.startsWith('/_next/')||path==='/favicon.svg')return NextResponse.next();
 const user=currentUser(request);
 if(!user){
  const response=path.startsWith('/api/')?NextResponse.json({error:'Требуется вход.'},{status:401}):NextResponse.redirect(new URL('/login',request.url));
  response.headers.set('Cache-Control','no-store');return response;
 }
 return NextResponse.next();
}
export const config={matcher:['/((?!_next/static|_next/image).*)']};
