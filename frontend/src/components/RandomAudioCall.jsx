import {useEffect,useRef,useState} from 'react';
import api from '../api/client';
import Icon from './Icon';

export default function RandomAudioCall({session,stream,onEnd}) {
  const audio=useRef(null),[status,setStatus]=useState('Connecting your call…'),[muted,setMuted]=useState(false),[needsPlay,setNeedsPlay]=useState(false);
  useEffect(()=>{
    let stopped=false,peer,timer,connectionTimeout,polling=false,cursor=0,remoteCandidates=[];
    const signal=payload=>api.post(`/aura-chat/${session.sessionId}/signals`,payload);
    const flush=async()=>{for(const candidate of remoteCandidates)await peer.addIceCandidate(candidate);remoteCandidates=[];};
    const fail=message=>{if(!stopped){setStatus(message);peer?.close();stream?.getTracks().forEach(t=>t.stop());clearInterval(timer);clearTimeout(connectionTimeout);}};
    const setup=async()=>{
      try {
        if(!stream?.getAudioTracks().some(t=>t.readyState==='live'))throw new Error('Microphone is unavailable. End this call and try again.');
        const {data}=await api.get('/aura-chat/call-config');if(stopped)return;
        peer=new RTCPeerConnection({iceServers:data.iceServers});
        stream.getTracks().forEach(track=>peer.addTrack(track,stream));
        peer.onicecandidate=e=>{if(e.candidate&&!stopped)signal({type:'candidate',candidate:e.candidate.toJSON()}).catch(()=>fail('Call connection interrupted. Please end and try again.'));};
        peer.ontrack=async e=>{if(audio.current){audio.current.srcObject=e.streams[0];try{await audio.current.play();}catch{setNeedsPlay(true);}}};
        peer.onconnectionstatechange=()=>{if(stopped)return;if(peer.connectionState==='connected'){clearTimeout(connectionTimeout);setStatus('Connected · You’re live');}else if(peer.connectionState==='failed')fail('Could not connect this call. Please end and try again.');else if(peer.connectionState==='disconnected')setStatus('Connection interrupted…');};
        connectionTimeout=setTimeout(()=>fail('Could not reach the other person. Please end and try again.'),45000);
        if(session.initiator){const offer=await peer.createOffer();if(stopped)return;await peer.setLocalDescription(offer);await signal({type:'offer',sdp:offer.sdp});}
        const poll=async()=>{
          if(stopped||polling)return;polling=true;
          try {
            const {data:signals}=await api.get(`/aura-chat/${session.sessionId}/signals?after=${cursor}`);
            for(const row of signals){if(stopped)return;const p=row.payload;
              if(p.type==='candidate'){if(peer.remoteDescription)await peer.addIceCandidate(p.candidate);else remoteCandidates.push(p.candidate);}
              else if(p.type==='offer'&&!session.initiator){await peer.setRemoteDescription({type:'offer',sdp:p.sdp});await flush();const answer=await peer.createAnswer();await peer.setLocalDescription(answer);await signal({type:'answer',sdp:answer.sdp});}
              else if(p.type==='answer'&&session.initiator){await peer.setRemoteDescription({type:'answer',sdp:p.sdp});await flush();}
              cursor=row.id;
            }
          }catch(err){if(err.response?.status===409||err.response?.status===404)fail('This call has ended.');else fail('Call connection interrupted. Please end and try again.');}finally{polling=false;}
        };
        timer=setInterval(poll,1200);poll();
      }catch(err){fail(err.message||'Unable to connect this call.');}
    };
    setup();return()=>{stopped=true;clearInterval(timer);clearTimeout(connectionTimeout);peer?.close();if(audio.current)audio.current.srcObject=null;};
  },[session.sessionId,session.initiator,stream]);
  const toggleMute=()=>{stream?.getAudioTracks().forEach(track=>{track.enabled=muted;});setMuted(!muted);};
  return <section className="farming-call"><audio ref={audio} autoPlay/><div className="farming-call-orb"><Icon name="mic" size={42}/></div><h2>Just your voices.</h2><p role="status">{status}</p>{needsPlay&&<button className="aura-btn-primary" onClick={async()=>{try{await audio.current.play();setNeedsPlay(false);}catch{setStatus('Tap again to enable audio.');}}}>Play call audio</button>}<div className="farming-call-actions"><button aria-pressed={muted} onClick={toggleMute}>{muted?'Unmute microphone':'Mute microphone'}</button><button className="end-call" onClick={onEnd}>End call</button></div><small>You can report this person using the report button above.</small></section>;
}
