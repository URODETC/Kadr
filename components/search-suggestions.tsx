'use client';
import {useEffect,useId,useRef,useState} from 'react';

export type SearchSuggestion={id:string;title:string;image?:string;subtitle?:string;href:string};
type Props={value:string;onChange:(value:string)=>void;load:(query:string,signal:AbortSignal)=>Promise<SearchSuggestion[]>;onSelect:(item:SearchSuggestion)=>void;onSearch:(query:string)=>void};
const normalize=(value:string)=>value.toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
export function bestMatches(items:SearchSuggestion[],query:string){
 const q=normalize(query);
 const score=(title:string)=>{const text=normalize(title);return text===q?0:text.startsWith(q)?1:text.includes(q)?2:3;};
 return [...new Map(items.map(item=>[item.id,item])).values()].sort((a,b)=>score(a.title)-score(b.title)).slice(0,6);
}
export default function SearchSuggestions({value,onChange,load,onSelect,onSearch}:Props){
 const id=useId(),root=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[active,setActive]=useState(-1),[composing,setComposing]=useState(false);
 const [result,setResult]=useState<{query:string;loader:Props['load'];items:SearchSuggestion[];error:string}|null>(null);
 const query=value.trim(),eligible=query.length>=2;
 const current=result?.query===query&&result.loader===load;
 const items=current?result.items:[],waiting=!current;
 const expanded=open&&eligible&&!composing;
 useEffect(()=>{
  if(!expanded)return;
  const abort=new AbortController();
  const timer=setTimeout(()=>{void load(query,abort.signal).then(rows=>{if(!abort.signal.aborted)setResult({query,loader:load,items:bestMatches(rows,query),error:''});}).catch(error=>{if(!abort.signal.aborted)setResult({query,loader:load,items:[],error:error instanceof Error?error.message:'Не удалось загрузить подсказки'});});},250);
  return()=>{clearTimeout(timer);abort.abort();};
 },[query,load,expanded]);
 useEffect(()=>{const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)){setOpen(false);setActive(-1);}};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 useEffect(()=>{if(expanded&&active>=0)document.getElementById(`${id}-${active}`)?.scrollIntoView({block:'nearest'});},[active,expanded,id]);
 function choose(item:SearchSuggestion){setOpen(false);setActive(-1);onSelect(item);}
 function search(){setOpen(false);setActive(-1);onSearch(query);}
 return <div className="search-suggest" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);setActive(-1);}}}>
  <label htmlFor={id}>Поиск аниме</label>
  <input id={id} type="search" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-list`} aria-activedescendant={expanded&&items[active]?`${id}-${active}`:undefined} autoComplete="off" maxLength={100} placeholder="Название аниме…" value={value}
   onFocus={()=>setOpen(true)} onChange={e=>{onChange(e.target.value);setActive(-1);setOpen(true);}}
   onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}
   onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();setOpen(false);setActive(-1);}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(index=>items.length?(index<0?(e.key==='ArrowDown'?0:items.length-1):(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length):-1);}else if(e.key==='Enter'){e.preventDefault();if(expanded&&items[active])choose(items[active]);else search();}}}/>
  {expanded&&<div className="search-suggest-popup">
   <div role="status" className="search-suggest-status">{waiting?'Ищем…':result?.error||(!items.length?'Ничего не найдено':'Лучшие совпадения')}</div>
   <ul id={`${id}-list`} role="listbox" aria-label="Результаты поиска" aria-busy={waiting}>
    {items.map((item,index)=><li id={`${id}-${index}`} role="option" tabIndex={-1} aria-selected={active===index} key={item.id} className="search-suggest-option" onPointerDown={e=>{if(e.pointerType==='mouse')e.preventDefault();}} onClick={()=>choose(item)}>
     {item.image?<img src={item.image} alt="" loading="lazy"/>:<span className="search-suggest-poster" aria-hidden="true">▶</span>}
     <span><strong>{item.title}</strong>{item.subtitle&&<small>{item.subtitle}</small>}</span><span aria-hidden="true">↗</span>
    </li>)}
   </ul>
   <button type="button" className="search-suggest-all" onClick={search}>Все результаты →</button>
  </div>}
 </div>;
}
