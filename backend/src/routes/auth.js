const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { authLimit } = require('../authLimits');
const { bannedAccountResponse } = require('../managementNotices');
const { authenticate } = require('../middleware/auth');
const { isWorkStatus } = require('../workStatus');

const router = express.Router();
const policies = require('../policies.json');
router.get('/policies', (_req, res) => res.json(policies));
function requirePolicy(req, res) {
  const c = req.body.policyConsent;
  if (c?.version === policies.version && c.terms === true && c.privacy === true && c.adult === true) return true;
  res.status(428).json({code:'POLICY_ACCEPTANCE_REQUIRED',error:'Review the policies and confirm you are 18 or older before creating an account.'});
  return false;
}
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function databaseUnavailable(error) {
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P03', '53300'].includes(error.code) ||
    error.errors?.some(databaseUnavailable) || /connection terminated|connection timeout/i.test(error.message || '');
}
function respondToDatabaseFailure(error, res) {
  if (!databaseUnavailable(error)) return false;
  res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' });
  return true;
}


function deviceLabel(req) {
  const agent = req.get('User-Agent') || '';
  const device = /iPad/i.test(agent) ? 'iPad' : /iPhone/i.test(agent) ? 'iPhone' :
    /Android/i.test(agent) ? 'Android' : /Windows/i.test(agent) ? 'Windows' :
    /Macintosh/i.test(agent) ? 'Mac' : /Linux/i.test(agent) ? 'Linux' : 'Unknown device';
  const browser = /Edg/i.test(agent) ? 'Edge' : /Firefox/i.test(agent) ? 'Firefox' :
    /Chrome|CriOS/i.test(agent) ? 'Chrome' : /Safari/i.test(agent) ? 'Safari' : '';
  return browser ? `${device} · ${browser}` : device;
}

async function issueSessionToken(user, req) {
  const sessionId = crypto.randomUUID();
  const version = user.auth_version || 0;
  const token = jwt.sign({ userId: user.id, version }, process.env.JWT_SECRET, { jwtid: sessionId });
  await db.query('INSERT INTO account_sessions (user_id, session_id, auth_version, device_label) VALUES ($1,$2,$3,$4)',
    [user.id, sessionId, version, deviceLabel(req)]);
  return token;
}

router.get('/sessions', authenticate, async (req, res, next) => {
  const { userId, version = 0, jti } = req.user;
  try {
    const { rows } = await db.query(`SELECT device_label, created_at, session_id=$3 AS current
      FROM account_sessions WHERE user_id=$1 AND auth_version=$2 AND revoked_at IS NULL
      ORDER BY current DESC, created_at DESC`, [userId, version, jti || '']);
    if (!rows.some(session => session.current)) {
      rows.unshift({ device_label: deviceLabel(req), created_at: req.user.iat ? new Date(req.user.iat * 1000) : null, current: true });
    }
    res.set('Cache-Control', 'no-store').json(rows);
  } catch (error) { next(error); }
});

router.delete('/sessions/current', authenticate, async (req, res, next) => {
  const { userId, version = 0, jti } = req.user;
  try {
    if (jti) {
      await db.query(`INSERT INTO account_sessions (user_id, session_id, auth_version, device_label, revoked_at)
        VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (user_id, session_id)
        DO UPDATE SET revoked_at=NOW()`, [userId, jti, version, deviceLabel(req)]);
      req.app.get('io')?.in(`account-session:${userId}:${jti}`).disconnectSockets(true);
    }
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.delete('/sessions', authenticate, async (req, res, next) => {
  const { userId, version = 0 } = req.user;
  try {
    await db.query(`WITH revoked AS (
      UPDATE users SET auth_version=auth_version+1 WHERE id=$1 AND auth_version=$2 RETURNING id
    ) DELETE FROM account_sessions WHERE user_id IN (SELECT id FROM revoked) AND auth_version<=$2`, [userId, version]);
    req.app.get('io')?.in(`account-version:${userId}:${version}`).disconnectSockets(true);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, confirmPassword, workStatus = null } = req.body;
    if (workStatus !== null && !isWorkStatus(workStatus)) {
      return res.status(400).json({ error: 'Choose Student or Working individual.' });
    }

    if (!email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Email, password, and confirm password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    if (!requirePolicy(req, res)) return;
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await db.query(
      'INSERT INTO users (email, password_hash, policy_version, policy_accepted_at, adult_confirmed_at, work_status) VALUES ($1, $2, $3, NOW(), NOW(), $4) RETURNING id, email',
      [email, passwordHash, policies.version, workStatus]
    );

    const user = result.rows[0];
    if(user.banned_at)return res.status(403).json({code:'ACCOUNT_BANNED',error:'This account has been banned. Contact AURA support.'});
    const token = await issueSessionToken(user, req);

    res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error('Signup error:', err);
    if (respondToDatabaseFailure(err, res)) return;
    res.status(500).json({ error: 'Server error during signup.' });
  }
});

// POST /api/auth/login
const limitLogin = authLimit('login', req => {
  const email = typeof req.body?.email === 'string' ? req.body.email.slice(0, 254).trim().toLowerCase() : '';
  return [[`ip:${req.ip}`, 40], [`account:${email}`, 8]];
});
router.post('/login', limitLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || email.length > 254 || password.length > 128) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if(user.banned_at)return await bannedAccountResponse(res,user.id);
    const token = await issueSessionToken(user, req);

    // Check if user has completed aura setup
    const auraResult = await db.query('SELECT aura_name FROM auras WHERE user_id = $1', [user.id]);
    const hasAura = auraResult.rows.length > 0;

    res.json({
      message: 'Login successful.',
      token,
      user: { id: user.id, email: user.email, hasAura, management_role:user.management_role||'user' },
    });
  } catch (err) {
    console.error('Login error:', err);
    if (respondToDatabaseFailure(err, res)) return;
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// POST /api/auth/google - Google OAuth Sign In / Sign Up
router.post('/google', async (req, res) => {
  try {
    const { tokenId, workStatus = null } = req.body;

    if (!tokenId) {
      return res.status(400).json({ error: 'Google token is required.' });
    }

    if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID.includes('your-google-client-id')) {
      return res.status(500).json({ error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID in .env.' });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokenId,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload.email;
    const realName = payload.name;

    if (!email) {
      return res.status(400).json({ error: 'Google account has no email.' });
    }

    // Check if user exists
    let result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    let user = result.rows[0];

    if (!user) {
      if (!requirePolicy(req, res)) return;
      if (workStatus !== null && !isWorkStatus(workStatus)) {
        return res.status(400).json({ error: 'Choose Student or Working individual.' });
      }
      // Create new user with Google
      const randomPassword = crypto.randomBytes(20).toString('hex');
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(randomPassword, salt);

      const insertResult = await db.query(
        'INSERT INTO users (email, password_hash, real_name, policy_version, policy_accepted_at, adult_confirmed_at, work_status) VALUES ($1, $2, $3, $4, NOW(), NOW(), $5) RETURNING id, email, real_name',
        [email, passwordHash, realName || null, policies.version, workStatus]
      );
      user = insertResult.rows[0];
    }

    if(user.banned_at)return res.status(403).json({code:'ACCOUNT_BANNED',error:'This account has been banned. Contact AURA support.'});
    const token = await issueSessionToken(user, req);

    // Check if user has aura
    const auraResult = await db.query('SELECT aura_name FROM auras WHERE user_id = $1', [user.id]);
    const hasAura = auraResult.rows.length > 0;

    res.json({
      message: hasAura ? 'Google login successful.' : 'Google signup successful.',
      token,
      user: { id: user.id, email: user.email, hasAura, management_role:user.management_role||'user' },
    });
  } catch (err) {
    console.error('Google auth error:', err);
    if (respondToDatabaseFailure(err, res)) return;
    if (err.message && err.message.includes('token')) {
      return res.status(401).json({ error: 'Invalid Google token.' });
    }
    res.status(500).json({ error: 'Google authentication failed.' });
  }
});

// POST /api/auth/logout (client-side token removal; server can blacklist if needed)
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully.' });
});

module.exports = router;
