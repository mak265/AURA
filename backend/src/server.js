const jwt = require('jsonwebtoken');
const db = require('./db');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const auraRoutes = require('./routes/aura');
const discoverRoutes = require('./routes/discover');
const matchesRoutes = require('./routes/matches');
const auraChatRoutes = require('./routes/auraChat');
const profileRoutes = require('./routes/profile');
const feedRoutes = require('./routes/feed');

const app = express();
if (process.env.TRUSTED_PROXY_CIDRS) {
  app.set('trust proxy', process.env.TRUSTED_PROXY_CIDRS.split(',').map(value => value.trim()).filter(Boolean));
}
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.set('io', io);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'AURA API' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/aura', auraRoutes);
app.use('/api/discover', discoverRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/aura-chat', auraChatRoutes);
app.use('/api/meet-sessions', require('./routes/meetSessions').router);
app.use('/api/lounge', require('./routes/lounge'));
app.use('/api/profile', profileRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/activity', require('./routes/activity'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin',require('./routes/admin'));
app.use('/api/glimpses', require('./routes/glimpses'));
app.use('/api/murmurs', require('./routes/murmurs'));
app.use('/api/notifications', require('./nativePush').router);
app.use('/api/aura-requests', require('./routes/auraRequests'));

// Only authenticated participants may receive a conversation's live events.
io.use(async (socket, next) => {
  try {
    const decoded=jwt.verify(socket.handshake.auth?.token,process.env.JWT_SECRET);
    socket.userId=decoded.userId;
    socket.sessionId=decoded.jti;
    const account=await db.query(`SELECT banned_at,auth_version,
      EXISTS(SELECT 1 FROM account_sessions WHERE user_id=users.id AND session_id=$2 AND revoked_at IS NOT NULL) AS session_revoked
      FROM users WHERE id=$1`,[socket.userId,socket.sessionId || null]);
    socket.authVersion=decoded.version||0;
    if(!account.rowCount||account.rows[0].banned_at||account.rows[0].session_revoked||socket.authVersion!==account.rows[0].auth_version)return next(new Error('Account unavailable.'));
    next();
  } catch { next(new Error('Authentication required.')); }
});
io.on('connection', socket => {
  socket.data.alertAuthVersion = socket.authVersion;
  socket.join(`alerts:${socket.userId}`);
  socket.join(`account-version:${socket.userId}:${socket.authVersion}`);
  if (socket.sessionId) socket.join(`account-session:${socket.userId}:${socket.sessionId}`);
  require('./conversationSocket').registerConversationSocket(socket);
});

require('./reportEvidence').startEvidenceCleanup();
require('./auraFarming').startSignalCleanup();
require('./authLimits').startAuthLimitCleanup();
require('./routes/meetSessions').startMeetReminders(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, process.env.HOST, () => {
  console.log(`🚀 AURA server running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api`);
  if (process.env.NODE_ENV === 'production') {
    require('./imageModeration').warmup()
      .then(() => console.log('Image scanner ready.'))
      .catch(error => console.warn('Image scanner warmup:', error.message));
  }
});

module.exports = { app, server, io };

