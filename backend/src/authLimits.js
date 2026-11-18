const { createHmac } = require('node:crypto');
const db = require('./db');

function authLimit(scope, getLimits) {
  return async (req, res, next) => {
    const limits = getLimits(req);
    const buckets = limits.map(([key]) => createHmac('sha256', process.env.JWT_SECRET).update(`${scope}:${key}`).digest('hex'));
    try {
      const { rows } = await db.query(`
        INSERT INTO auth_attempt_limits (bucket, attempts, expires_at)
        SELECT bucket, 1, NOW() + INTERVAL '15 minutes'
        FROM unnest($1::text[]) AS items(bucket) ORDER BY bucket
        ON CONFLICT (bucket) DO UPDATE SET
          attempts = CASE WHEN auth_attempt_limits.expires_at <= NOW() THEN 1
            ELSE LEAST(auth_attempt_limits.attempts + 1, 1000000) END,
          expires_at = CASE WHEN auth_attempt_limits.expires_at <= NOW()
            THEN EXCLUDED.expires_at ELSE auth_attempt_limits.expires_at END
        RETURNING bucket, attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - NOW())))::int AS retry_after
      `, [buckets]);
      const retryAfter = Math.max(0, ...rows.map(row => {
        const limit = limits[buckets.indexOf(row.bucket)][1];
        return row.attempts > limit ? row.retry_after : 0;
      }));
      if (retryAfter) {
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      }
      next();
    } catch (error) {
      console.error('Auth attempt limit lookup failed:', error.code || error.name);
      res.status(503).json({ error: 'Sign-in is temporarily unavailable.' });
    }
  };
}

function startAuthLimitCleanup() {
  const timer = setInterval(() => {
    db.query('DELETE FROM auth_attempt_limits WHERE expires_at <= NOW()')
      .catch(error => console.error('Auth attempt cleanup failed:', error.code || error.name));
  }, 15 * 60 * 1000);
  timer.unref();
}

module.exports = { authLimit, startAuthLimitCleanup };
