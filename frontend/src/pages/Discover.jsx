import ContentSkeleton from '../components/ContentSkeleton';
import Icon from '../components/Icon';
import { ConnectionDetails } from '../components/ConnectionProfile';
import { INTENTIONS } from '../connectionOptions';
import { useState, useEffect, useRef } from 'react';
import api from '../api/client';
import BottomNav from '../components/BottomNav';

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

export default function Discover() {
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

  const sendAura = async (userId) => {
    try {
      await api.post(`/discover/${userId}/send-aura`);
      setCards(prev => prev.filter(c => c.id !== userId));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send aura.');
    }
  };

  return (
    <div className="min-h-screen bg-aura-deep pb-24">
      <div className="page-heading flex justify-between items-center">
        <div><p className="eyebrow">Room for something real</p><h1>Discover</h1><p className="text-sm text-gray-400 mt-2">A personality worth getting to know.</p></div>
        <button
          aria-label="Filter people" aria-expanded={showFilters} onClick={() => setShowFilters(s => !s)}
          className="w-9 h-9 rounded-xl bg-aura-card border border-aura-border flex items-center justify-center text-aura-violet-light relative"
        >
          <Icon name="filters"/>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-aura-pink text-[9px] font-bold flex items-center justify-center text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <div className="discover-search-wrap"><div className="discover-search"><Icon name="discover" size={19}/><input type="search" aria-label="Search by Aura name" placeholder="Search by Aura name…" maxLength={80} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label="Clear search" onClick={()=>setSearch('')}>×</button>}</div><p>Find an Aura. A little mystery stays.</p></div>
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
          {cards.map(card => (
            <div key={card.id} className="aura-card overflow-hidden">
              <div className="identity-cover" style={{ '--identity-color': card.aura_color || 'linear-gradient(135deg,#897294,#b38d98)' }}>
                <div className="identity-orbit" aria-hidden="true"/><div className="identity-initial" aria-hidden="true">{card.aura_name?.charAt(0)}</div>
                <span className="identity-label"><Icon name="lock" size={12}/> A little mystery, for now</span>
              </div>
              <div className="p-4">
                <div className="text-xl font-extrabold">{card.aura_name}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {[card.age, card.gender, card.city].filter(Boolean).join(' · ')}
                </div>
                <ConnectionDetails intention={card.dating_intention} answers={card.prompt_answers} />
                <div className="text-sm mt-2.5">"{card.bio}"</div>
                <div className="flex gap-1.5 mt-3 flex-wrap">
                  {card.interests?.map((i, idx) => (
                    <span key={idx} className="text-[11px] px-2.5 py-1 rounded-full bg-aura-elevated text-aura-violet-light">
                      {i.name}
                    </span>
                  ))}
                </div>
                <div className="compatibility-note"><Icon name="heart" size={15}/><div><span>Compatibility · {card.compatibility}%</span><p>{card.reasons?.filter(reason => reason !== 'Within preferred distance').join(' · ')}</p></div></div>
                <div className="flex gap-2.5 mt-4">
                  <button onClick={() => setCards(previous => previous.filter(person => person.id !== card.id))} className="flex-1 py-3 rounded-xl bg-aura-elevated text-gray-300 text-sm font-medium">Pass for now</button>
                  <button
                    onClick={() => sendAura(card.id)}
                    className="aura-btn-primary flex-1 !w-auto !py-3 text-sm"
                  >
                    Send interest
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
