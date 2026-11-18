import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor, registerPlugin } from '@capacitor/core';
import api from '../api/client';
import Icon from './Icon';
import RandomAudioCall from './RandomAudioCall';
import CallVisual from './CallVisual';

const callBackground = registerPlugin('CallBackground');

export default function ConnectionCall({ matchId, myId, name, buttonHost, onKeep, onRelease }) {
  const endpoint = `/matches/${matchId}/call`;
  const [call, setCall] = useState(null);
  const [stream, setStream] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [minimized, setMinimized] = useState(false);
  const current = useRef({ call: null, stream: null, busy: false, revision: 0 });
  const dialog = useRef(null);

  useEffect(() => {
    if (!stream || Capacitor.getPlatform() !== 'android') return;
    let active = true;
    callBackground.start().catch(() => {
      if (active) setError('Keep AURA open to continue this call.');
    });
    return () => {
      active = false;
      callBackground.stop().catch(() => {});
    };
  }, [stream]);

  function updateCall(next) {
    const previous = current.current.call;
    current.current.call = next;
    setCall(next);
    if (!next || (previous && previous.id !== next.id)) setMinimized(false);
    if ((!next || (previous && previous.id !== next.id)) && current.current.stream) {
      current.current.stream.getTracks().forEach(track => track.stop());
      current.current.stream = null;
      setStream(null);
    }
    if (!next && previous) onRelease();
  }

  useEffect(() => {
    let mounted = true;
    let polling = false;
    const state = current.current;
    const refresh = async () => {
      if (state.busy || polling || (document.hidden && !state.call)) return;
      polling = true;
      const revision = state.revision;
      try {
        const { data } = await api.get(endpoint, { timeout: 8000 });
        if (!mounted || revision !== state.revision || state.busy) return;
        if (state.call && (!data.call || data.call.id !== state.call.id)) setError('Call ended.');
        updateCall(data.call);
      } catch (failure) {
        if (mounted && revision === state.revision && failure.response?.status === 404) updateCall(null);
      } finally {
        polling = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      mounted = false;
      state.revision++;
      clearInterval(timer);
      state.stream?.getTracks().forEach(track => track.stop());
      if (state.call && (state.call.caller_id === myId || state.stream)) {
        api.post(`${endpoint}/${state.call.id}/end`, {}, { timeout: 5000 }).catch(() => {});
      }
    };
  }, [endpoint, myId]);

  const showing = Boolean(call);
  const expanded = showing && !minimized;
  useEffect(() => {
    if (!showing) return;
    const element = dialog.current;
    if (expanded) element.showModal();
    else element.close();
    return () => element.close();
  }, [showing, expanded]);

  async function act(action) {
    const state = current.current;
    if (state.busy) return;
    state.busy = true;
    const revision = ++state.revision;
    const previous = state.call;
    if (action !== 'end') onKeep();
    setBusy(true);
    setError('');
    let microphone;
    try {
      if (action !== 'end') {
        if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
          throw new Error('Voice calls need microphone access in a supported app or browser.');
        }
        microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (state.revision !== revision) return;
      }
      const url = action === 'start' ? endpoint : `${endpoint}/${previous.id}/${action}`;
      const { data } = await api.post(url, {}, { timeout: 10000 });
      if (state.revision !== revision) {
        if (data.call && (action === 'accept' || data.call.caller_id === myId)) {
          api.post(`${endpoint}/${data.call.id}/end`, {}, { timeout: 5000 }).catch(() => {});
        }
        return;
      }
      if (microphone && (action === 'accept' || data.call.caller_id === myId)) {
        state.stream = microphone;
        setStream(microphone);
        microphone = null;
      }
      updateCall(data.call);
    } catch (failure) {
      if (state.revision !== revision) return;
      if (action === 'end' || failure.response?.status === 409) updateCall(null);
      setError(failure.response?.data?.error ||
        (failure.name === 'NotAllowedError' ? 'Allow microphone access to make a call.' : 'Could not complete the call. Try again.'));
    } finally {
      microphone?.getTracks().forEach(track => track.stop());
      if (state.revision === revision) {
        state.busy = false;
        setBusy(false);
        if (!state.call) onRelease();
      }
    }
  }

  return <>
    {buttonHost && createPortal(<><button type="button" className="mobile-icon-action shrink-0"
      aria-label={showing ? 'Return to voice call' : 'Start voice call'} disabled={busy}
      onClick={() => showing ? setMinimized(false) : act('start')}>
      <Icon name="phone" size={19}/>
    </button>
    {error && !showing && <p role="status" className="connection-call-toast">{error}</p>}</>, buttonHost)}
    {showing && minimized && <aside className="connection-call-mini" aria-label="Minimized voice call">
      <button type="button" className="connection-call-reopen" onClick={() => setMinimized(false)}>
        <Icon name="phone" size={16}/> <span>{call.status === 'ringing' ? 'Calling' : 'Voice call'} · {name}</span>
      </button>
      <button type="button" className="connection-call-hangup" aria-label="End minimized call" disabled={busy} onClick={() => act('end')}>End</button>
    </aside>}
    {call && createPortal(<dialog ref={dialog} className="connection-call-dialog" aria-label="Connection voice call"
      onCancel={event => { event.preventDefault(); if (!busy && stream) setMinimized(true); }}>
      {stream && <button type="button" className="connection-call-minimize" onClick={() => setMinimized(true)}>Minimize</button>}
      {call.status === 'active' && stream ?
        <RandomAudioCall key={call.id} session={{ sessionId: call.id, initiator: call.caller_id === myId }}
          signalsPath={`${endpoint}/${call.id}/signals`} stream={stream} onEnd={() => act('end')} connectionName={name}
          onConnected={() => api.post(`${endpoint}/${call.id}/connected`, {}, { timeout: 8000 }).catch(() => {})}/> :
        <section className="farming-call">
          <CallVisual phase={call.status === 'ringing' ? 'ringing' : 'connecting'}/>
          <h2>{name}</h2>
          <p role="status">{call.status === 'active' ? 'This call is already active.' : call.caller_id === myId ? 'Calling…' : 'Incoming voice call'}</p>
          <div className="farming-call-actions">
            {call.status === 'ringing' && call.caller_id !== myId &&
              <button type="button" disabled={busy} onClick={() => act('accept')}>{busy ? 'Connecting…' : 'Answer'}</button>}
            <button type="button" className="end-call" disabled={busy} onClick={() => act('end')}>
              {call.status === 'active' ? 'End call' : call.caller_id === myId ? 'Cancel' : 'Decline'}
            </button>
          </div>
        </section>}
      {error && <p className="px-5 pb-4 text-center text-xs text-red-600" role="alert">{error}</p>}
    </dialog>, document.body)}
  </>;
}
