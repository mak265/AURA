import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import ConnectionCall from './ConnectionCall';

const CallContext = createContext(null);

export function ConnectionCallProvider({ children, myId }) {
  const [chat, setChat] = useState(null);
  const [pinned, setPinned] = useState(null);
  const target = pinned || chat;

  return <CallContext.Provider value={setChat}>
    {children}
    {myId && target && <ConnectionCall key={target.matchId} matchId={target.matchId} myId={myId}
      name={chat?.matchId === target.matchId ? chat.name : target.name}
      buttonHost={chat?.host}
      onKeep={() => setPinned({ matchId: target.matchId, name: target.name })}
      onRelease={() => setPinned(null)}/>}
  </CallContext.Provider>;
}

export function ConnectionCallButton({ matchId, name }) {
  const setChat = useContext(CallContext);
  const host = useRef(null);
  useLayoutEffect(() => {
    const target = { matchId, name, host: host.current };
    setChat(target);
    return () => setChat(previous => previous === target ? null : previous);
  }, [setChat, matchId, name]);
  return <div ref={host} className="shrink-0"/>;
}
