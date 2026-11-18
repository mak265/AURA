import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import api from '../api/client';
import AppTopBar from './AppTopBar';
import ScheduledMeetSessions from './ScheduledMeetSessions';
import WorkStatusOptions from './WorkStatusOptions';
import { loungeInvitePath } from '../loungeInvite';
import './meet-lobby.css';

const religions = ['Iglesia ni Cristo', 'Catholic', 'Born Again / Evangelical', 'Christian', 'Seventh-day Adventist',
  "Jehovah's Witnesses", 'Mormon / Latter Day Saints', 'Pentecostal', 'Baptist', 'Methodist', 'Protestant',
  'Muslim', 'Buddhist', 'Hindu', 'Jewish', 'Sikh', 'Taoist', "Baha'i", 'Agnostic', 'Atheist', 'Other'];

const actions = [
  { mode: 'chat', label: 'Find a chat', icon: 'talk', quota: 'chatsRemaining' },
  { mode: 'call', label: 'Find a call', icon: 'phone', quota: 'callsRemaining' },
];

function LiveLounges({ visible }) {
  const [rooms, setRooms] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    async function loadRooms() {
      try {
        const { data } = await api.get('/lounge', { signal: controller.signal, timeout: 5000 });
        if (controller.signal.aborted) return;
        setRooms(data.filter(room => room.visibility === 'public' && !room.full).slice(0, 3));
        setUnavailable(false);
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    }
    loadRooms();
    const timer = setInterval(loadRooms, 6000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [visible]);

  return <section className="meet-lounges" aria-labelledby="meet-lounges-title">
    <div className="meet-section-heading">
      <h2 id="meet-lounges-title">Lounges</h2>
      <Link to="/aura-lounge" aria-label="Browse lounges">Browse <Icon name="arrow" size={16}/></Link>
    </div>
    {unavailable || !rooms?.length ? (
      <p className="meet-lounges-status" role="status">
        {unavailable ? 'Couldn’t load lounges. Retrying…' : rooms ? 'No public rooms open.' : 'Loading lounges…'}
      </p>
    ) : (
      <ul className="meet-room-list">
        {rooms.map(room => <li key={room.id}>
          <Link to={loungeInvitePath(room.id)} className="meet-room">
            <span className="meet-room-icon"><Icon name="mic" size={19}/></span>
            <span className="meet-room-name"><strong>{room.name}</strong><small>{room.listeners} listening</small></span>
            <Icon name="arrow" size={17}/>
          </Link>
        </li>)}
      </ul>
    )}
  </section>;
}

export default function FarmingLobby({ mode, filters, setFilters, onStart, loading, statusMessage, visible = true }) {
  const [allowance, setAllowance] = useState(null);
  const [allowanceError, setAllowanceError] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [filterError, setFilterError] = useState('');
  const filterButton = useRef(null);
  const filterSheet = useRef(null);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    async function loadAllowance() {
      try {
        const { data } = await api.get('/aura-chat/allowance', { signal: controller.signal, timeout: 5000 });
        if (controller.signal.aborted) return;
        setAllowance(data);
        setAllowanceError(false);
      } catch {
        if (!controller.signal.aborted) setAllowanceError(true);
      }
    }
    loadAllowance();
    const timer = setInterval(loadAllowance, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) filterSheet.current?.close();
  }, [visible]);

  const premium = allowance?.premium;
  const religionRemaining = allowance?.religionRemaining;
  const religionBlocked = !premium && Boolean(filters.religion) && religionRemaining === 0;
  const activeFilters = Number(Boolean(filters.ageMin || filters.ageMax)) +
    [filters.gender, filters.workStatus, filters.religion].filter(Boolean).length;
  const reset = allowance?.resetsAt ? new Date(allowance.resetsAt).toLocaleString() : null;

  function canStart(actionMode) {
    const action = actions.find(action => action.mode === actionMode);
    return !loading && Boolean(allowance) && (premium || allowance[action.quota] !== 0) && !religionBlocked;
  }

  function openFilters() {
    setDraft(filters);
    setFilterError('');
    filterSheet.current.showModal();
  }

  function changeFilter(key, value) {
    setDraft(current => ({ ...current, [key]: value }));
    setFilterError('');
  }

  function applyFilters(event) {
    event.preventDefault();
    if (draft.ageMin && draft.ageMax && Number(draft.ageMin) > Number(draft.ageMax)) {
      setFilterError('Maximum age must be at least the minimum age.');
      return;
    }
    setFilters(draft);
    filterSheet.current.close();
  }

  return <main className="meet-screen">
    <AppTopBar title="Meet"/>
    <div className="meet-content">
      <div className="meet-section-heading">
        <h2 id="meet-title">Start anonymously</h2>
        <button type="button" ref={filterButton} className="meet-filter-button" aria-haspopup="dialog"
          aria-label={activeFilters ? `Filters, ${activeFilters} active` : undefined} disabled={loading}
          onClick={openFilters}>
          <Icon name="filters" size={17}/>
          <strong>Filters</strong>
          {activeFilters > 0 && <span aria-hidden="true">{activeFilters}</span>}
        </button>
      </div>

      {religionBlocked && <p className="meet-status" role="status">Religion filter allowance used. Choose Any religion to search.</p>}
      {(statusMessage || allowanceError) && <p className="meet-status" role="status">
        {statusMessage || 'Couldn’t load your allowance. Retrying…'}
      </p>}

      <div className="meet-actions" role="group" aria-labelledby="meet-title">
        {actions.map(action => {
          const remaining = allowance?.[action.quota];
          const quota = premium ? 'Unlimited' : remaining === undefined ? 'Checking…'
            : remaining === 0 ? 'Limit reached' : `${remaining} free left`;
          return <button type="button" key={action.mode} className="meet-action" data-mode={action.mode}
            disabled={!canStart(action.mode)}
            onClick={() => onStart(action.mode)}>
            <span className="meet-action-icon"><Icon name={action.icon} size={21}/></span>
            <strong>{loading && mode === action.mode ? 'Starting…' : action.label}</strong>
            <small>{quota}</small>
          </button>;
        })}
      </div>
      {!premium && reset && (allowance?.chatsRemaining === 0 || allowance?.callsRemaining === 0) &&
        <p className="meet-quota-reset">Free matches reset {reset}.</p>}

      <ScheduledMeetSessions visible={visible} onJoin={onStart} canJoin={canStart}/>
      <LiveLounges visible={visible}/>
    </div>

    <dialog className="meet-filter-sheet" ref={filterSheet} aria-labelledby="meet-filter-title"
      onClose={() => { if (visible) filterButton.current?.focus(); }}>
      <form onSubmit={applyFilters}>
        <header>
          <h2 id="meet-filter-title">Match filters</h2>
          <button type="button" aria-label="Close filters" className="meet-filter-close" autoFocus
            onClick={() => filterSheet.current.close()}>×</button>
        </header>
        <div className="meet-filter-fields">
          <div className="farming-age-row">
            <label>Minimum age
              <input type="number" min="18" max="120" placeholder="18+" value={draft.ageMin}
                onChange={event => changeFilter('ageMin', event.target.value)}/>
            </label>
            <label>Maximum age
              <input type="number" min="18" max="120" placeholder="Any" value={draft.ageMax}
                onChange={event => changeFilter('ageMax', event.target.value)}/>
            </label>
          </div>
          <label>Gender
            <select value={draft.gender} onChange={event => changeFilter('gender', event.target.value)}>
              <option value="">Any gender</option>
              {['Female', 'Male', 'Nonbinary'].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>Study or work status
            <select value={draft.workStatus} onChange={event => changeFilter('workStatus', event.target.value)}>
              <WorkStatusOptions emptyLabel="Any status"/>
            </select>
          </label>
          <label>Religion <small>{premium ? 'Unlimited with Premium' : `${religionRemaining ?? '…'} free left`}</small>
            <select disabled={!allowance} value={draft.religion} onChange={event => changeFilter('religion', event.target.value)}>
              <option value="">Any religion</option>
              {religions.map(value => <option key={value} disabled={!premium && religionRemaining === 0}>{value}</option>)}
            </select>
          </label>
          {!premium && <p>3 free religion-filter pairings per 24 hours, shared across chat and call.</p>}
          {!premium && <p>Only successful matches use your allowance.</p>}
          {filterError && <p className="meet-status" role="alert">{filterError}</p>}
        </div>
        <footer>
          <button type="button" className="aura-btn-secondary"
            onClick={() => { setDraft({ ageMin: '', ageMax: '', gender: '', workStatus: '', religion: '' }); setFilterError(''); }}>
            Clear all
          </button>
          <button type="submit" className="aura-btn-primary">Apply filters</button>
        </footer>
      </form>
    </dialog>
  </main>;
}
