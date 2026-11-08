import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import io from 'socket.io-client';
import api from '../api/client';

export default function useConversationSocket({kind,id,enabled=true,myId,...callbacks}) {
  const listeners=useRef(callbacks);
  useLayoutEffect(()=>{listeners.current=callbacks;});
  const socketRef=useRef(null),stopRef=useRef(()=>{}),updateRef=useRef(()=>{});
  const scopeKey=`${kind}:${id}`;
  const [typing,setTyping]=useState({scope:null,active:false});
  useEffect(()=>{
    if(!enabled||!id)return;
    const scope={kind,id:Number(id)},token=localStorage.getItem('aura_token');
    if(!token)return;
    const socket=io(new URL(api.defaults.baseURL,window.location.origin).origin,{auth:{token}});
    socketRef.current=socket;
    let joined=false,localActive=false,lastSent=0,localTimer,remoteTimer;
    const clearRemote=()=>{clearTimeout(remoteTimer);setTyping({scope:`${kind}:${id}`,active:false});};
    const stop=()=>{clearTimeout(localTimer);if(joined&&localActive)socket.emit('typing',{...scope,typing:false});localActive=false;};
    const update=text=>{
      if(!text.trim()){stop();return;}
      if(!joined||document.visibilityState!=='visible')return;
      const now=Date.now();
      if(!localActive||now-lastSent>1400){socket.emit('typing',{...scope,typing:true});localActive=true;lastSent=now;}
      clearTimeout(localTimer);localTimer=setTimeout(stop,1800);
    };
    stopRef.current=stop;updateRef.current=update;
    socket.on('connect',()=>{joined=false;clearRemote();socket.emit(kind==='match'?'join:match':'join:aura',kind==='match'?{matchId:Number(id)}:{sessionId:Number(id)},result=>{joined=!!result?.ok;});});
    socket.on('disconnect',()=>{joined=false;localActive=false;clearTimeout(localTimer);clearRemote();});
    socket.on('typing',event=>{if(event.kind!==scope.kind||Number(event.id)!==scope.id||Number(event.userId)===Number(myId))return;clearTimeout(remoteTimer);setTyping({scope:`${kind}:${id}`,active:event.typing===true});if(event.typing)remoteTimer=setTimeout(clearRemote,3500);});
    socket.on('message',message=>{if(Number(message.match_id)!==scope.id||kind!=='match')return;if(Number(message.sender_id)!==Number(myId))clearRemote();listeners.current.onMessage?.(message);});
    socket.on('message:unsent',event=>listeners.current.onUnsent?.(event));
    socket.on('message:reactions',event=>listeners.current.onReactions?.(event));
    socket.on('reveal:update',event=>listeners.current.onReveal?.(event));
    socket.on('soul_game:completed',()=>listeners.current.onUnlocked?.());
    const hide=()=>{if(document.visibilityState!=='visible'){stop();clearRemote();}};
    document.addEventListener('visibilitychange',hide);window.addEventListener('blur',stop);
    return()=>{stop();clearTimeout(remoteTimer);document.removeEventListener('visibilitychange',hide);window.removeEventListener('blur',stop);stopRef.current=()=>{};updateRef.current=()=>{};socket.removeAllListeners();socket.disconnect();socketRef.current=null;};
  },[kind,id,enabled,myId]);
  const updateTyping=useCallback(text=>updateRef.current(text),[]),stopTyping=useCallback(()=>stopRef.current(),[]);
  return {partnerTyping:enabled&&typing.scope===scopeKey&&typing.active,updateTyping,stopTyping};
}
