import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';

export default function useConnectionPlans(matchId, enabled) {
  const endpoint = `/matches/${matchId}/plans`;
  const [state, setState] = useState(null);
  const generation = useRef(0);
  const inFlight = useRef(null);
  const refresh = useCallback(async signal => {
    if (inFlight.current && !inFlight.current.signal?.aborted) return;
    const request = { version: ++generation.current, signal };
    inFlight.current = request;
    try {
      const { data } = await api.get(endpoint, { timeout: 5000, signal });
      if (!signal?.aborted && request.version === generation.current) {
        setState({ items: data, checkedAt: Date.now() });
      }
    } catch (error) {
      if (request.version === generation.current && error.response?.status === 404) setState(null);
    } finally {
      if (request === inFlight.current) inFlight.current = null;
    }
  }, [endpoint]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = () => refresh(controller.signal);
    const initial = setTimeout(load, 0);
    const timer = setInterval(load, 3000);
    return () => {
      controller.abort();
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [enabled, refresh]);

  function storePlan(plan) {
    generation.current++;
    const checkedAt = Date.now();
    setState(previous => {
      if (!previous) return previous;
      const existing = previous.items.find(item => item.id === plan.id);
      if (!existing) return { items: [...previous.items, plan], checkedAt };
      if (existing.revision > plan.revision) return previous;
      return { items: previous.items.map(item => item.id === plan.id ? plan : item), checkedAt };
    });
  }

  async function create(values) {
    const { data } = await api.post(endpoint, values, { timeout: 8000 });
    storePlan(data);
  }

  async function respond(plan, action, proposedAt) {
    try {
      const { data } = await api.patch(`${endpoint}/${plan.id}`, {
        action, proposedAt, revision: plan.revision,
      }, { timeout: 8000 });
      storePlan(data);
    } catch (error) {
      refresh();
      throw error;
    }
  }

  return { items: enabled ? state?.items : null, checkedAt: state?.checkedAt, create, respond };
}
