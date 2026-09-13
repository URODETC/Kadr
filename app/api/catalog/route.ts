import { catalog } from '@/lib/cinema/catalog';
export async function GET(request:Request){const url=new URL(request.url);const q=(url.searchParams.get('q')??'').toLowerCase().slice(0,150);return Response.json({items:catalog.filter(x=>(x.title+' '+x.original).toLowerCase().includes(q)),provider:'collaps',requiresKey:false},{headers:{'Cache-Control':'public, max-age=300'}});}
