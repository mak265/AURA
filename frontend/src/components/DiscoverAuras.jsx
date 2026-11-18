import {useEffect,useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import api from '../api/client';
import Avatar from './Avatar';
import Icon from './Icon';
import DiscoverAuraComposer from './DiscoverAuraComposer';

export default function DiscoverAuras({direction,targetId}) {
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(null),[match,setMatch]=useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const navigate=useNavigate(),sent=direction==='sent';
  const revision=useRef(0);
  const target = useRef(null);
  const highlighted = !sent && items.some(item => item.id === targetId);
  useEffect(() => { if (highlighted) target.current?.scrollIntoView({ block: 'center' }); }, [highlighted, targetId]);
  useEffect(()=>{
    let active=true,polling=false;
    const load=async()=>{if(polling||document.visibilityState!=='visible')return;polling=true;const version=revision.current;try{const {data}=await api.get('/discover/auras?direction='+direction);if(active&&version===revision.current){setItems(data);setError('');}}catch{if(active)setError('Unable to load Auras. Please try again.');}finally{polling=false;if(active)setLoading(false);}};
    load();const timer=setInterval(load,10000);document.addEventListener('visibilitychange',load);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[direction]);
  const pass = async item => {
    setBusy(item.id);setError('');
    try{
      await api.post('/discover/auras/'+item.id+'/pass');
      revision.current++;
      setItems(previous=>previous.filter(row=>row.id!==item.id));
      window.dispatchEvent(new Event('aura:inbox-change'));
    }catch(err){setError(err.response?.data?.error||'Unable to update this Aura.');}finally{setBusy(null);}
  };
  const sendBack = async opener => {
    const item = replyTo;
    const { data } = await api.post(`/discover/${item.user_id}/send-aura`, opener ? { opener } : {});
    if (data.matched) setMatch({ ...data, name: item.aura_name });
    revision.current++;
    setItems(previous => previous.flatMap(row => {
      if (row.id !== item.id) return [row];
      return data.matched && row.opener ? [{ ...row, match_id: data.matchId, can_chat: data.canChat }] : [];
    }));
    window.dispatchEvent(new Event('aura:inbox-change'));
  };
  return <section className="discover-aura-inbox" aria-label={sent?'Sent Auras':'Received Auras'}>
    <header><h2>{sent?'Auras you’ve sent':'Someone noticed your aura'}</h2><p>{sent?'Your recent Discover interests. A connection begins when the feeling is mutual.':'These people sent you an Aura from Discover. Send one back to make a connection.'}</p></header>
    {match&&<div className="discover-aura-notice" role="status"><Icon name="heart" size={20}/><div><strong>You and {match.name||'this Aura'} matched!</strong><p>{match.canChat?'Your conversation is ready.':'Find your match in Connections.'}</p><button onClick={()=>navigate(match.canChat ? '/chat/'+match.matchId : '/matches')}>{match.canChat?'Open conversation':'View Connections'} →</button></div></div>}
    {error&&<p role="alert" className="farming-error">{error}</p>}
    {loading?<p className="discover-aura-empty" role="status">Loading Auras…</p>:!items.length?<div className="discover-aura-empty"><Icon name="heart" size={25}/><h3>{sent?'No sent Auras yet':'You’re all caught up'}</h3><p>{sent?'Send an Aura to someone who catches your interest in Explore.':'New Discover interests will appear here. Journal messages stay in Connections → Requests.'}</p></div>:items.map(item=><article key={item.id} ref={!sent && item.id === targetId ? target : null} className={`discover-aura-card${!sent && item.id === targetId ? ' ring-2 ring-aura-violet' : ''}`}>
      <div className="discover-aura-person"><Avatar name={item.aura_name||'Aura'} gender={item.gender} size={45}/><div><h3>{item.aura_name||'An Aura'}</h3><p>{[item.age?item.age+' years old':null,item.gender,item.city].filter(Boolean).join(' · ')}</p></div><span className="discover-aura-state">{item.match_id ? 'Mutual' : sent ? 'Sent' : 'Sent you an Aura'}</span></div>
      {item.opener && <div className="discover-prompt discover-inbox-opener">
        <p>{sent ? 'Your opener' : 'Their opener'}</p>
        <blockquote>{item.opener}</blockquote>
      </div>}
      {item.bio&&<p className="discover-aura-bio">{item.bio}</p>}
      {item.dating_intention&&<span className="discover-aura-intention">{item.dating_intention}</span>}
      <p className="discover-aura-date">{new Date(item.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})} · Discover</p>
      {item.match_id
        ? <button className="aura-btn-primary" onClick={() => navigate(item.can_chat ? '/chat/' + item.match_id : '/matches')}>{item.can_chat ? 'Open conversation' : 'View Connections'}</button>
        : sent ? <p className="discover-aura-pending">Waiting for them to send an Aura back.</p>
          : <div className="discover-card-actions">
            <button className="aura-btn-secondary" disabled={busy !== null} onClick={() => pass(item)}>{busy === item.id ? 'Passing…' : 'Pass'}</button>
            <button className="aura-btn-primary" disabled={busy !== null} onClick={() => setReplyTo(item)}>Send Aura back</button>
          </div>}
    </article>)}
    {replyTo && <DiscoverAuraComposer name={replyTo.aura_name || 'this Aura'} replying
      prompt={replyTo.opener ? { question: 'Their opener', answer: replyTo.opener } : null}
      onSend={sendBack} onClose={() => setReplyTo(null)} />}
  </section>;
}
