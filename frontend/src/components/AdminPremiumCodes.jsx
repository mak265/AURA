import { useEffect, useState } from 'react';
import api from '../api/client';
import Icon from './Icon';
import './premium.css';

const endpoint = '/admin/premium-codes';
const initialForm = { label: '', code: '', maxClaims: '25', days: '30', claimWindowDays: '' };

export default function AdminPremiumCodes() {
  const [form, setForm] = useState(initialForm);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api.get(endpoint, { params: { page }, signal: controller.signal })
      .then(response => setData(response.data))
      .catch(() => {
        if (!controller.signal.aborted) setError('Unable to load Premium codes.');
      });
    return () => controller.abort();
  }, [page, version]);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const { data: code } = await api.post(endpoint, {
        ...form, days: Number(form.days), maxClaims: Number(form.maxClaims),
        claimWindowDays: form.claimWindowDays ? Number(form.claimWindowDays) : null
      });
      setForm(initialForm);
      setPage(1);
      setVersion(previous => previous + 1);
      setMessage(`Created ${code.code}`);
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to create a code.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post(`${endpoint}/${id}/revoke`);
      setConfirmId(null);
      setVersion(previous => previous + 1);
      setMessage('Code revoked. Previous claims keep their Premium time.');
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to revoke this code.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(code) {
    try {
      await navigator.clipboard.writeText(code);
      setMessage(`Copied ${code}`);
    } catch {
      setMessage('Select and copy the code from the table.');
    }
  }

  const field = key => ({
    value: form[key],
    onChange: event => setForm(previous => ({ ...previous, [key]: event.target.value }))
  });

  return <>
    <div className="admin-heading"><div><h1>Premium codes</h1><p>Create and manage codes for beta giveaways.</p></div></div>
    <section className="admin-card premium-builder">
      <div className="admin-card-title"><div><h2>Create a giveaway</h2><p>Set the reward and how many people can claim it.</p></div><span className="premium-builder-icon"><Icon name="spark" size={20}/></span></div>
      <form className="premium-builder-form" onSubmit={create}>
        <label>Campaign label <small>Optional</small><input maxLength={80} placeholder="Beta testers" {...field('label')}/></label>
        <label>Custom code <small>Optional</small><input minLength={6} maxLength={40} placeholder="Auto-generated if blank" {...field('code')}/></label>
        <label>Maximum claimants<input type="number" min={1} max={100000} required {...field('maxClaims')}/></label>
        <label>Premium days per person<input type="number" min={1} max={365} required {...field('days')}/></label>
        <label>Days to claim <small>Optional</small><input type="number" min={1} max={365} placeholder="No expiry" {...field('claimWindowDays')}/></label>
        <div className="premium-builder-action"><button className="admin-button" disabled={busy}>{busy ? 'Saving…' : 'Generate code'}</button></div>
      </form>
    </section>
    {message && <p role="status" className="premium-result premium-result-success">{message}</p>}
    {error && <p role="alert" className="admin-warning">{error}</p>}
    <section className="admin-card">
      <div className="admin-card-title"><div><h2>Giveaway codes</h2><p>Track claims and share active codes.</p></div></div>
      {!data?.codes.length ? <p className="admin-help">{data ? 'No codes on this page.' : 'Loading codes…'}</p> :
        <div className="admin-table-scroll"><table>
          <thead><tr><th>Code</th><th>Premium</th><th>Claims</th><th>Claim deadline</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{data.codes.map(code => {
            const status = code.revoked_at ? 'Revoked' : code.expires_at && Date.parse(code.expires_at) <= Date.now()
              ? 'Expired' : code.claimed_count >= code.max_claims ? 'Fully claimed' : 'Active';
            return <tr key={code.id}>
              <td><code className="premium-code-label">{code.code}</code>{code.label && <small className="admin-block">{code.label}</small>}</td>
              <td>{code.premium_days} days</td>
              <td><div className="premium-claim-meter"><span>{code.claimed_count} / {code.max_claims}</span><progress aria-label="Claims used" value={code.claimed_count} max={code.max_claims}/></div></td>
              <td>{code.expires_at ? new Date(code.expires_at).toLocaleString() : 'No expiry'}</td>
              <td><span className={`premium-status${status === 'Active' ? ' premium-status-active' : ''}`}>{status}</span></td>
              <td>
                {status === 'Active' && <button className="admin-text-button" onClick={() => copy(code.code)}>Copy</button>}
                {status === 'Active' && (confirmId === code.id
                  ? <><button className="admin-button danger" disabled={busy} onClick={() => revoke(code.id)}>Confirm revoke</button><button className="admin-text-button" onClick={() => setConfirmId(null)}>Cancel</button></>
                  : <button className="admin-text-button" onClick={() => setConfirmId(code.id)}>Revoke</button>)}
              </td>
            </tr>;
          })}</tbody>
        </table></div>}
      {(page > 1 || data?.hasMore) && <div className="admin-toolbar">
        <button className="admin-button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page}</span>
        <button className="admin-button secondary" disabled={!data?.hasMore} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
    </section>
  </>;
}
