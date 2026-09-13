import type {Metadata} from 'next';
import Register from '@/components/register';
export const metadata:Metadata={title:'Приглашение · Кадр',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <Register/>;}
