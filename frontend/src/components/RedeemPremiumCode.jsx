import { useState } from 'react';
import api from '../api/client';
import Icon from './Icon';
import './premium.css';

export default function RedeemPremiumCode({ premiumUntil, onRedeemed }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function redeem(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post('/profile/redeem-code', { code });
      onRedeemed(data.premium_until);
      setSuccess(`${data.days} ${data.days === 1 ? 'day' : 'days'} of Premium added.`);
      setCode('');
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to redeem the code.');
    } finally {
      setBusy(false);
    }
  }

  const active = Date.parse(premiumUntil) > Date.now();
  return <div className="premium-redeem">
    <section className="premium-hero">
      <div className="premium-hero-top"><Icon name="spark" size={24}/><span>{active ? 'Premium active' : 'Beta giveaway'}</span></div>
      <h2>AURA Premium</h2>
      <p>{active
        ? `Active until ${new Date(premiumUntil).toLocaleDateString([], { dateStyle: 'long' })}`
        : 'Unlock Private dating mode, see who viewed your profile, and meet more people.'}</p>
    </section>
    <form className="premium-redeem-form" onSubmit={redeem}>
      <h3>Redeem a giveaway code</h3>
      <p>Enter the code you received. If you already have Premium, the extra days are added to your current plan.</p>
      <label className="block text-sm">Premium code
        <input className="aura-input mt-2 premium-code-input" value={code} onChange={event => setCode(event.target.value.toUpperCase())}
        required maxLength={40} autoComplete="off" spellCheck={false} placeholder="Enter your code" />
      </label>
      <button className="aura-btn-primary w-full" disabled={busy || !code.trim()}>{busy ? 'Redeeming…' : 'Redeem code'}</button>
      {success && <div role="status" className="premium-result premium-result-success">{success}</div>}
      {error && <div role="alert" className="premium-result premium-result-error">{error}</div>}
    </form>
  </div>;
}
