import { useEffect, useRef, useState } from 'react';
import ReactionIcon from './ReactionIcon';
import { ReactionPicker } from './ReactionList';
const labels={like:'Like',love:'Love',care:'Care',haha:'Haha',wow:'Wow',sad:'Sad',angry:'Angry'};
export default function ReactionButton({ reaction, onReact }) {
  const button=useRef(null),timer=useRef(null),held=useRef(false),origin=useRef(null);
  const [anchor,setAnchor]=useState(null);
  const clear=()=>{clearTimeout(timer.current);timer.current=null;};
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const open=()=>{held.current=true;setAnchor(button.current.getBoundingClientRect());};
  return <><button ref={button} className={`journal-action ${reaction?'selected':''}`} aria-label={reaction?'Remove reaction':'Like post'} title="Press and hold for more reactions" aria-expanded={!!anchor}
    onPointerDown={event=>{if(event.button!==0)return;held.current=false;origin.current={x:event.clientX,y:event.clientY};clear();timer.current=setTimeout(open,450);}}
    onPointerMove={event=>{if(origin.current&&Math.hypot(event.clientX-origin.current.x,event.clientY-origin.current.y)>12)clear();}}
    onPointerUp={()=>{const wasPending=!!timer.current;clear();origin.current=null;if(!held.current&&wasPending)onReact(reaction||'like');}}
    onPointerCancel={()=>{clear();origin.current=null;}}
    onPointerLeave={()=>{clear();origin.current=null;}}
    onContextMenu={event=>event.preventDefault()}
    onClick={event=>{if(event.detail===0&&!held.current)onReact(reaction||'like');}}
    onKeyDown={event=>{if(event.key==='ArrowUp'){event.preventDefault();open();}}}
    style={{touchAction:'pan-y',WebkitTouchCallout:'none',userSelect:'none'}}>
    <ReactionIcon type={reaction||'like'} size={23} muted={!reaction}/><span>{labels[reaction]||'Like'}</span>
  </button>{anchor&&<ReactionPicker anchor={anchor} selected={reaction} onSelect={onReact} onClose={()=>{setAnchor(null);held.current=false;}}/>}</>;
}

