import {useState} from 'react';

export default function useMessageArrivals(messages,scope,loaded=false) {
  const [history,setHistory]=useState(()=>({scope,messages,loaded,ready:loaded||messages.length>0,ids:new Set(messages.map(m=>m.id)),fresh:new Set()}));
  if(history.scope!==scope||history.messages!==messages||history.loaded!==loaded){
    const sameScope=history.scope===scope;
    const ids=new Set(sameScope?history.ids:[]);
    const fresh=new Set(sameScope&&history.ready?messages.filter(m=>!ids.has(m.id)).map(m=>m.id):[]);
    for(const message of messages)ids.add(message.id);
    setHistory({scope,messages,loaded,ready:loaded||messages.length>0,ids,fresh});
  }
  return history.fresh;
}
