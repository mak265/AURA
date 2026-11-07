import { useCallback, useEffect, useRef } from 'react';
export default function useChatScroll(messages) {
 const container=useRef(null),followLatest=useRef(true),lastId=useRef(null),initialized=useRef(false);
 const lastMessageId=messages.at(-1)?.id;
 const listRef=useCallback(node=>{
  container.current=node;if(!node)return;initialized.current=false;followLatest.current=true;node.scrollTop=node.scrollHeight;
  const onScroll=()=>{followLatest.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;};
  const resize=new ResizeObserver(()=>{if(followLatest.current)node.scrollTop=node.scrollHeight;});
  const observe=()=>{for(const child of node.children)resize.observe(child);};observe();
  const changes=new MutationObserver(observe);changes.observe(node,{childList:true});
  node.addEventListener('scroll',onScroll,{passive:true});
  return()=>{resize.disconnect();changes.disconnect();node.removeEventListener('scroll',onScroll);container.current=null;};
 },[]);
 useEffect(()=>{const list=container.current;if(!list||!lastMessageId)return;
  if(followLatest.current){const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;list.scrollTo({top:list.scrollHeight,behavior:initialized.current&&lastId.current!==lastMessageId&&!reduce?'smooth':'instant'});}
  initialized.current=true;lastId.current=lastMessageId;
 },[lastMessageId]);
 return {listRef,stickToBottom:()=>{followLatest.current=true;}};
}
