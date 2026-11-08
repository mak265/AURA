const db = require('./db');
const fail = (message, status = 400, code) => Object.assign(new Error(message), {status, code});
function parseOptions(options = {}) {
  const mode = options.mode ?? 'chat', f = options.filters ?? {};
  if (!['chat','call'].includes(mode) || !f || typeof f !== 'object' || Array.isArray(f)) throw fail('Choose chat or call and valid filters.');
  const age = value => value === undefined || value === null || value === '' ? null : value;
  const min = age(f.ageMin), max = age(f.ageMax);
  if ([min,max].some(v => v !== null && (!Number.isInteger(v) || v < 18 || v > 120)) || (min !== null && max !== null && min > max)) throw fail('Choose an age range between 18 and 120.');
  for (const key of ['gender','religion']) if (f[key] !== undefined && (typeof f[key] !== 'string' || f[key].length > 100)) throw fail('Invalid matching filters.');
  return {mode, filters:{ageMin:min,ageMax:max,gender:f.gender?.trim() || '',religion:f.religion?.trim() || ''}};
}
async function allowance(client, userId) {
  const result = await client.query(`SELECT u.premium_until > NOW() AS premium,
    CASE WHEN f.window_started_at + INTERVAL '24 hours' > NOW() THEN f.chats ELSE 0 END AS chats,
    CASE WHEN f.window_started_at + INTERVAL '24 hours' > NOW() THEN f.calls ELSE 0 END AS calls,
    CASE WHEN f.window_started_at + INTERVAL '24 hours' > NOW() THEN f.window_started_at + INTERVAL '24 hours' END AS resets_at
    FROM users u LEFT JOIN farming_usage f ON f.user_id=u.id WHERE u.id=$1`, [userId]);
  const row = result.rows[0];
  if (!row) throw fail('Account not found.',404);
  return {premium:!!row.premium,chatsRemaining:Math.max(0,5-(row.chats || 0)),callsRemaining:Math.max(0,3-(row.calls || 0)),resetsAt:row.resets_at};
}
async function checkAllowance(client,userId,mode,filters) {
  const a = await allowance(client,userId);
  if (filters.religion && !a.premium) throw fail('Religion filters require AURA Premium.',403,'PREMIUM_REQUIRED');
  if (!a.premium && a[mode === 'call' ? 'callsRemaining' : 'chatsRemaining'] === 0) throw fail('Your free '+(mode === 'call' ? 'calls' : 'chats')+' are used up. Try after your 24-hour reset or use Premium.',403,'DAILY_LIMIT');
  return a;
}
async function charge(client,userId,mode) {
  // Queue lock serializes charges and matching, so concurrent starts cannot overspend.
  const column = mode === 'call' ? 'calls' : 'chats';
  await client.query(`INSERT INTO farming_usage(user_id,${column}) VALUES($1,1)
    ON CONFLICT(user_id) DO UPDATE SET
    chats=CASE WHEN farming_usage.window_started_at+INTERVAL '24 hours'<=NOW() THEN ${mode==='chat'?1:0} ELSE farming_usage.chats+${mode==='chat'?1:0} END,
    calls=CASE WHEN farming_usage.window_started_at+INTERVAL '24 hours'<=NOW() THEN ${mode==='call'?1:0} ELSE farming_usage.calls+${mode==='call'?1:0} END,
    window_started_at=CASE WHEN farming_usage.window_started_at+INTERVAL '24 hours'<=NOW() THEN NOW() ELSE farming_usage.window_started_at END`,[userId]);
}
async function cleanupSignals() {
  await db.query(`DELETE FROM farming_signals f USING aura_sessions s
    WHERE f.session_id=s.id AND (s.status<>'active' OR s.created_at<=NOW()-INTERVAL '5 minutes')`);
}
function startSignalCleanup() {
  const run=()=>cleanupSignals().catch(error=>console.error('Call signal cleanup failed:',error.code||error.name));
  run();const timer=setInterval(run,60000);timer.unref();return timer;
}
module.exports = {parseOptions,allowance,checkAllowance,charge,fail,cleanupSignals,startSignalCleanup};
