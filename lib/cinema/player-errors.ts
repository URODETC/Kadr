/** Do not expose Shaka's error.data: it can contain signed CDN URLs. */
export function playbackError(value:unknown):{fatal:boolean;message:string}|null {
 const e=value as {code?:number;severity?:number;category?:number}|null;
 if(e?.code===7000||e?.code===7001)return null; // Superseded load or destroyed player.
 const code=typeof e?.code==='number'?` (код ${e.code})`:'';
 if(e?.severity===1)return {fatal:false,message:`Повторная загрузка фрагмента…${code}`};
 const reason=e?.category===1?'Не удалось загрузить видео.':e?.category===3?'Браузер не смог декодировать видео.':e?.category===4?'Не удалось прочитать плейлист.':'Не удалось воспроизвести поток.';
 return {fatal:true,message:reason+code};
}
