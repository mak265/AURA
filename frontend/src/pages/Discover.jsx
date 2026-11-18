import DiscoverAuras from '../components/DiscoverAuras';
import DiscoverAuraComposer from '../components/DiscoverAuraComposer';
import {useAuth} from '../context/AuthContext';
import {useNavigate, useSearchParams} from 'react-router-dom';
import ContentSkeleton from '../components/ContentSkeleton';
import Icon from '../components/Icon';
import { ProfileSilhouette } from '../components/Avatar';
import AppTopBar from '../components/AppTopBar';
import { ConnectionDetails } from '../components/ConnectionProfile';
import { INTENTIONS, PROMPTS } from '../connectionOptions';
import { useState, useEffect, useRef } from 'react';
import api from '../api/client';
import './discover.css';

const GENDERS = ['Male', 'Female', 'Nonbinary'];

const RELIGIONS = [
  'Iglesia ni Cristo', 'Catholic', 'Born Again / Evangelical', 'Christian',
  'Seventh-day Adventist', "Jehovah's Witnesses", 'Mormon / Latter Day Saints',
  'Pentecostal', 'Baptist', 'Methodist', 'Protestant', 'Muslim', 'Buddhist',
  'Hindu', 'Jewish', 'Sikh', 'Taoist', "Baha'i", 'Agnostic', 'Atheist',
  'Spiritual', 'Other',
];

const INTERESTS_LIST = [
  { id: 1, name: 'Music', emoji: '🎵' },
  { id: 2, name: 'Coffee', emoji: '☕' },
  { id: 3, name: 'Travel', emoji: '✈️' },
  { id: 4, name: 'Art', emoji: '🎨' },
  { id: 5, name: 'Gaming', emoji: '🎮' },
  { id: 6, name: 'Movies', emoji: '🎬' },
  { id: 7, name: 'Reading', emoji: '📚' },
  { id: 8, name: 'Fitness', emoji: '💪' },
  { id: 9, name: 'Food', emoji: '🍜' },
  { id: 10, name: 'Photography', emoji: '📷' },
  { id: 11, name: 'Nature', emoji: '🌿' },
  { id: 12, name: 'Dancing', emoji: '💃' },
];

function firstPrompt(answers) {
  const index = PROMPTS.findIndex((_, i) => typeof answers?.[i] === 'string' && answers[i].trim());
  return index === -1 ? null : { index, question: PROMPTS[index], answer: answers[index] };
}

function InterestTags({ interests }) {
  return <ul className="discover-interest-tags">
    {interests.map(({ name, emoji }) => <li key={name}>{emoji && <span aria-hidden="true">{emoji}</span>}{name}</li>)}
  </ul>;
}

function DiscoverCard({ card, onPass, onSend }) {
  const prompt = firstPrompt(card.prompt_answers);
  const additionalAnswers = PROMPTS.map((_, i) => i === prompt?.index ? '' : card.prompt_answers?.[i]);
  const shared = card.shared_interests || [];
  const otherInterests = (card.interests || []).filter(interest => !shared.some(common => common.name === interest.name));

  return <article className="aura-card discover-person-card overflow-hidden">
    <header className="discover-person-cover" style={{ '--identity-color': card.aura_color || '#855ac5' }}>
      <ProfileSilhouette gender={card.gender} className="discover-person-silhouette"/>
      <div className="discover-person-name">
        <h2>{card.aura_name}</h2>
        {card.username && <p>@{card.username}</p>}
        <p>{[card.age, card.gender, card.city].filter(Boolean).join(' · ')}</p>
      </div>
      <span className="discover-person-private"><Icon name="lock" size={12}/> Identity hidden</span>
    </header>
    <div className="discover-person-content">
      {prompt ? <div className="discover-prompt">
        <p>{prompt.question}</p>
        <blockquote>{prompt.answer}</blockquote>
      </div> : card.bio && <p className="discover-person-bio">{card.bio}</p>}
      {card.dating_intention && <div className="discover-person-intention">
        <span>Dating intention</span>
        <strong>{card.dating_intention}</strong>
      </div>}
      {shared.length > 0 && <div className="discover-person-shared">
        <h3>Shared interests</h3>
        <InterestTags interests={shared} />
      </div>}
      <details className="discover-person-details" onToggle={event => {
        if (event.currentTarget.open) api.post(`/discover/${card.id}/view`).catch(() => {});
      }}>
        <summary>View Aura profile</summary>
        {additionalAnswers.some(Boolean) && <ConnectionDetails answers={additionalAnswers} />}
        {prompt && card.bio && <p className="discover-person-bio">{card.bio}</p>}
        {otherInterests.length > 0 && <div className="discover-person-shared">
          <h3>{shared.length ? 'Other interests' : 'Interests'}</h3>
          <InterestTags interests={otherInterests} />
        </div>}
        {Number.isFinite(card.compatibility) && <p className="discover-person-reasons">{card.compatibility}% estimated compatibility</p>}
        <p className="discover-person-reasons">Premium members can see that you opened their profile.</p>
      </details>
      <div className="discover-card-actions">
        <button className="aura-btn-secondary" onClick={() => onPass(card.id)}>Pass for now</button>
        <button className="aura-btn-primary" onClick={() => onSend({ card, prompt })}>Send Aura</button>
      </div>
    </div>
  </article>;
}

export default function Discover() {
  const {auraInboxCount=0}=useAuth();
  const navigate=useNavigate();
  const [query, setQuery] = useSearchParams();
  const idFromQuery = Number(query.get('aura'));
  const receivedAura = Number.isSafeInteger(idFromQuery) && idFromQuery > 0 ? idFromQuery : null;
  const [selectedTab,setSelectedTab]=useState('explore'),[notice,setNotice]=useState(null),[recipient,setRecipient]=useState(null);
  const auraTab = receivedAura ? 'received' : selectedTab;
  const setAuraTab = value => {
    setSelectedTab(value);
    if (receivedAura) setQuery(previous => { const next = new URLSearchParams(previous); next.delete('aura'); return next; }, { replace: true });
  };
  const [search,setSearch]=useState('');
  const [appliedFilters,setAppliedFilters]=useState(null);
  const requestId=useRef(0);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    dating_intention: '',
    gender: '',
    religion: '',
    age_min: '',
    age_max: '',
    interests: [],
  });

  useEffect(() => {
    const timer=setTimeout(()=>fetchCards(appliedFilters,search),search?300:0);
    return()=>{clearTimeout(timer);requestId.current++;};
  }, [search,appliedFilters]);

  const fetchCards = async (activeFilters = appliedFilters, query = search) => {
    const current=++requestId.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const f = activeFilters || {interests:[]};
      if(query.trim())params.append('q',query.trim());
      if (f.dating_intention) params.append('dating_intention', f.dating_intention);
      if (f.gender) params.append('gender', f.gender);
      if (f.religion) params.append('religion', f.religion);
      if (f.age_min) params.append('age_min', f.age_min);
      if (f.age_max) params.append('age_max', f.age_max);
      if (f.interests.length > 0) params.append('interests', f.interests.join(','));

      const res = await api.get(`/discover${params.toString() ? '?' + params.toString() : ''}`);
      if(current===requestId.current)setCards(res.data);
    } catch (err) {
      if(current===requestId.current)setError(err.response?.data?.error || 'Failed to load auras.');
    } finally {
      if(current===requestId.current)setLoading(false);
    }
  };

  const toggleInterest = (name) => {
    setFilters(prev => ({
      ...prev,
      interests: prev.interests.includes(name)
        ? prev.interests.filter(i => i !== name)
        : [...prev.interests, name],
    }));
  };

  const applyFilters = () => {
    setAppliedFilters({...filters});
    setShowFilters(false);
  };

  const clearFilters = () => {
    const empty = { dating_intention: '', gender: '', religion: '', age_min: '', age_max: '', interests: [] };
    setFilters(empty);
    setAppliedFilters(empty);
    setShowFilters(false);
  };

  const activeFilterCount =
    (filters.dating_intention ? 1 : 0) +
    (filters.gender ? 1 : 0) +
    (filters.religion ? 1 : 0) +
    (filters.age_min ? 1 : 0) +
    (filters.age_max ? 1 : 0) +
    (filters.interests.length > 0 ? 1 : 0);

  const sendAura = async opener => {
    const userId = recipient.card.id;
    const { data } = await api.post(`/discover/${userId}/send-aura`, opener ? { opener } : {});
    setNotice(data);
    window.dispatchEvent(new Event('aura:inbox-change'));
    setCards(previous => previous.filter(card => card.id !== userId));
  };

  return (
    <div className="mobile-tab-screen discover-screen min-h-screen bg-aura-deep pb-24">
      <AppTopBar title="Discover">
        {auraTab==='explore'&&<button
          aria-label="Filter people" aria-expanded={showFilters} onClick={() => setShowFilters(s => !s)}
          className="mobile-icon-action"
        >
          <Icon name="filters"/>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-aura-pink text-[9px] font-bold flex items-center justify-center text-white">
              {activeFilterCount}
            </span>
          )}
        </button>}
      </AppTopBar>

      <nav className="discover-aura-tabs" aria-label="Discover sections">{[['explore','Explore'],['received','Received Auras'],['sent','Sent Auras']].map(([value,label])=><button key={value} aria-pressed={auraTab===value} className={auraTab===value?'active':''} onClick={()=>{setAuraTab(value);setShowFilters(false);setNotice(null);}}>{label}{value==='received'&&auraInboxCount>0&&<span>{auraInboxCount}</span>}</button>)}</nav>
      {notice&&<div className="discover-aura-notice" role="status"><Icon name="heart" size={20}/><div><strong>{notice.matched?'Your Auras matched!':'Aura sent'}</strong><p>{notice.matched?'You can start your first conversation together.':'They can see your interest in Discover → Received Auras.'}</p><button onClick={()=>notice.matched?navigate(notice.canChat ? '/chat/'+notice.matchId : '/matches'):setAuraTab('sent')}>{notice.matched?'Open connection':'View sent Auras'} →</button></div></div>}
      {auraTab==='explore'&&auraInboxCount>0&&<button className="discover-incoming-banner" onClick={()=>setAuraTab('received')}><Icon name="heart" size={19}/><span><strong>{auraInboxCount} {auraInboxCount===1?'person sent':'people sent'} you an Aura</strong><small>See who’s interested in you</small></span><Icon name="arrow" size={17}/></button>}
      {auraTab!=='explore'?<DiscoverAuras key={auraTab} direction={auraTab} targetId={receivedAura}/>:<>
      <div className="discover-search-wrap"><div className="discover-search"><Icon name="discover" size={19}/><input type="search" aria-label="Search by Aura name or username" placeholder="Aura name or @username" maxLength={80} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label="Clear search" onClick={()=>setSearch('')}>×</button>}</div><p>Find an Aura. A little mystery stays.</p></div>
      {/* Filter Panel */}
      {showFilters && (
        <div className="px-5 pb-4">
          <div className="aura-card p-4 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold">Filters</h3>
              <button onClick={clearFilters} className="text-xs text-aura-pink font-semibold">Clear all</button>
            </div>

            <label className="block text-xs text-gray-400">DATING INTENTION<select className="aura-input mt-2" value={filters.dating_intention} onChange={e => setFilters({ ...filters, dating_intention: e.target.value })}><option value="">Any intention</option>{INTENTIONS.map(v => <option key={v}>{v}</option>)}</select></label>
            {/* Gender */}
            <div>
              <label className="text-xs font-semibold text-gray-400 mb-2 block">GENDER</label>
              <select
                className="aura-input"
                value={filters.gender}
                onChange={e => setFilters({ ...filters, gender: e.target.value })}
              >
                <option value="">All genders</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            {/* Age Range */}
            <div>
              <label className="text-xs font-semibold text-gray-400 mb-2 block">AGE RANGE</label>
              <div className="flex gap-3 items-center">
                <input
                  type="number"
                  min={18}
                  max={100}
                  className="aura-input"
                  placeholder="Min"
                  value={filters.age_min}
                  onChange={e => setFilters({ ...filters, age_min: e.target.value })}
                />
                <span className="text-gray-500">–</span>
                <input
                  type="number"
                  min={18}
                  max={100}
                  className="aura-input"
                  placeholder="Max"
                  value={filters.age_max}
                  onChange={e => setFilters({ ...filters, age_max: e.target.value })}
                />
              </div>
            </div>

            {/* Religion */}
            <div>
              <label className="text-xs font-semibold text-gray-400 mb-2 block">RELIGION</label>
              <select
                className="aura-input"
                value={filters.religion}
                onChange={e => setFilters({ ...filters, religion: e.target.value })}
              >
                <option value="">Any religion</option>
                {RELIGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Interests */}
            <div>
              <label className="text-xs font-semibold text-gray-400 mb-2 block">INTERESTS</label>
              <div className="flex gap-2 flex-wrap">
                {INTERESTS_LIST.map(i => {
                  const active = filters.interests.includes(i.name);
                  return (
                    <button
                      key={i.id}
                      onClick={() => toggleInterest(i.name)}
                      className={`text-xs px-2.5 py-1.5 rounded-full font-medium transition ${
                        active
                          ? 'bg-aura-violet text-white'
                          : 'bg-aura-elevated text-gray-300'
                      }`}
                    >
                      {i.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowFilters(false)}
                className="flex-1 py-3 rounded-xl bg-aura-elevated text-gray-300 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                onClick={applyFilters}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#897294,#b38d98)' }}
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-sm px-5">{error}</p>}

      {loading ? <ContentSkeleton/> : cards.length === 0 ? (
        <div className="text-center py-20 px-8">
          <div className="empty-symbol"><Icon name="discover" size={28}/></div>
          <p className="text-gray-400">{search.trim()?'No Auras found.':"You've seen all available Auras."}</p>
          <p className="text-gray-500 text-sm mt-1">Try another Aura name or adjust your filters.</p>
          <button onClick={() => fetchCards()} className="aura-btn-primary mt-6">Refresh</button>
        </div>
      ) : (
        <div className="px-4 space-y-4">
          {cards.map(card => <DiscoverCard key={card.id} card={card} onSend={setRecipient}
            onPass={id => setCards(previous => previous.filter(person => person.id !== id))} />)}
        </div>
      )}

      </>}
      {recipient && <DiscoverAuraComposer name={recipient.card.aura_name} prompt={recipient.prompt}
        onSend={sendAura} onClose={() => setRecipient(null)} />}
    </div>
  );
}
