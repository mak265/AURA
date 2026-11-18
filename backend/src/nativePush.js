const express = require('express');
const http2 = require('node:http2');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const db = require('./db');
const { authenticate } = require('./middleware/auth');

const router = express.Router();
router.use(authenticate, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const projectId = process.env.FCM_PROJECT_ID;
const androidAuth = projectId && new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
const apple = {
  team: process.env.APNS_TEAM_ID,
  keyId: process.env.APNS_KEY_ID,
  keyPath: process.env.APNS_KEY_PATH,
  bundle: process.env.APNS_BUNDLE_ID
};
const appleConfigured = Object.values(apple).every(Boolean);
const configured = { android: Boolean(androidAuth), ios: appleConfigured };
let appleToken;

function validDevice(platform, token) {
  if (typeof token !== 'string') return false;
  if (platform === 'ios') return /^[a-f0-9]{32,256}$/i.test(token) && token.length % 2 === 0;
  return platform === 'android' && /^[A-Za-z0-9_:-]{20,512}$/.test(token);
}

router.get('/config', (_req, res) => res.json(configured));

router.put('/device', async (req, res) => {
  const { platform, token, sound } = req.body || {};
  if (!validDevice(platform, token)) return res.status(400).json({ error: 'Invalid notification device.' });
  if (!configured[platform]) return res.status(503).json({ error: 'Native push is not configured for this platform.' });
  try {
    await db.query(`
      INSERT INTO native_push_devices (platform, token, user_id, auth_version, sound)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (platform, token) DO UPDATE SET user_id = EXCLUDED.user_id,
        auth_version = EXCLUDED.auth_version, sound = EXCLUDED.sound
    `, [platform, token, req.user.userId, req.user.version || 0, sound !== false]);
    res.sendStatus(204);
  } catch (error) {
    console.error('Native push registration failed:', error.code || error.name);
    res.status(500).json({ error: 'Could not register notifications.' });
  }
});

router.delete('/device', async (req, res) => {
  const { platform, token } = req.body || {};
  if (!validDevice(platform, token)) return res.status(400).json({ error: 'Invalid notification device.' });
  try {
    await db.query('DELETE FROM native_push_devices WHERE platform = $1 AND token = $2 AND user_id = $3',
      [platform, token, req.user.userId]);
    res.sendStatus(204);
  } catch {
    res.status(500).json({ error: 'Could not remove the notification device.' });
  }
});

async function sendAndroid(device, path, alert) {
  const client = await androidAuth.getClient();
  try {
    await client.request({
      url: `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      method: 'POST',
      timeout: 5000,
      data: { message: {
        token: device.token,
        notification: alert,
        data: { path },
        android: { priority: 'HIGH', ttl: '120s', notification: {
          channel_id: device.sound ? 'aura_messages_v1' : 'aura_messages_quiet_v1',
          ...(device.sound ? { sound: 'aura_chime' } : {})
        } }
      } }
    });
    return false;
  } catch (error) {
    if (error.response?.data?.error?.details?.some(item => item.errorCode === 'UNREGISTERED')) return true;
    throw error;
  }
}

function sendApple(device, path, alert) {
  if (!appleToken || appleToken.refreshAt <= Date.now()) {
    appleToken = {
      value: jwt.sign({}, fs.readFileSync(apple.keyPath), { algorithm: 'ES256', issuer: apple.team, keyid: apple.keyId }),
      refreshAt: Date.now() + 40 * 60000
    };
  }
  const host = process.env.APNS_ENV === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://${host}`);
    session.on('error', reject);
    session.setTimeout(5000, () => { session.destroy(); reject(new Error('APNs timeout')); });
    const stream = session.request({
      ':method': 'POST', ':path': `/3/device/${device.token}`,
      authorization: `bearer ${appleToken.value}`, 'apns-topic': apple.bundle,
      'apns-push-type': 'alert', 'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 120)
    });
    let status;
    stream.on('response', headers => { status = headers[':status']; });
    stream.on('error', error => { session.destroy(); reject(error); });
    stream.resume();
    stream.on('end', () => {
      session.close();
      if (status === 200 || status === 410) resolve(status === 410);
      else reject(new Error(`APNs delivery status ${status}`));
    });
    stream.end(JSON.stringify({ aps: { alert, ...(device.sound ? { sound: 'aura_chime.wav' } : {}) }, path }));
  });
}

async function sendNativePush(userId, authVersion, path, body = 'You have a new message.') {
  if (!configured.android && !configured.ios) return;
  const alert = { title: 'AURA', body };
  const { rows } = await db.query(
    'SELECT platform, token, sound FROM native_push_devices WHERE user_id = $1 AND auth_version = $2',
    [userId, authVersion]
  );
  await Promise.all(rows.filter(device => configured[device.platform]).map(async device => {
    try {
      const expired = await (device.platform === 'android' ? sendAndroid(device, path, alert) : sendApple(device, path, alert));
      if (expired) await db.query(
        'DELETE FROM native_push_devices WHERE platform = $1 AND token = $2 AND user_id = $3 AND auth_version = $4',
        [device.platform, device.token, userId, authVersion]
      );
    } catch (error) {
      console.error('Native push delivery failed:', device.platform, error.response?.status || error.code || error.name);
    }
  }));
}

module.exports = { router, sendNativePush };
