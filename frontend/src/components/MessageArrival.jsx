import {useLayoutEffect,useRef,useState} from 'react';
export default function MessageArrival({children,mine,fresh,className=''}) {
  const element=useRef(null);
  const [arrival]=useState({fresh,mine});
  useLayoutEffect(()=>{
    if(!arrival.fresh||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const animation=element.current?.animate?.([{opacity:0,transform:`translate3d(${arrival.mine?'7px':'-7px'},9px,0) scale(.97)`},{opacity:1,transform:'translate3d(0,0,0) scale(1)'}],{duration:260,easing:'cubic-bezier(.16,1,.3,1)'});
    return()=>animation?.cancel();
    // Entrance belongs to this mount; a receipt update must not interrupt it.
  },[arrival]);
  return <div ref={element} className={`message-arrival ${mine?'is-mine':''} ${className}`}>{children}</div>;
}
