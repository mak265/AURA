const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');

const router = express.Router();
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


// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body;

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

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

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
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
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

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Check if user has completed aura setup
    const auraResult = await db.query('SELECT aura_name FROM auras WHERE user_id = $1', [user.id]);
    const hasAura = auraResult.rows.length > 0;

    res.json({
      message: 'Login successful.',
      token,
      user: { id: user.id, email: user.email, hasAura },
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
    const { tokenId } = req.body;

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
      // Create new user with Google
      const randomPassword = crypto.randomBytes(20).toString('hex');
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(randomPassword, salt);

      const insertResult = await db.query(
        'INSERT INTO users (email, password_hash, real_name) VALUES ($1, $2, $3) RETURNING id, email, real_name',
        [email, passwordHash, realName || null]
      );
      user = insertResult.rows[0];
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Check if user has aura
    const auraResult = await db.query('SELECT aura_name FROM auras WHERE user_id = $1', [user.id]);
    const hasAura = auraResult.rows.length > 0;

    res.json({
      message: hasAura ? 'Google login successful.' : 'Google signup successful.',
      token,
      user: { id: user.id, email: user.email, hasAura },
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
