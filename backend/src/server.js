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
app.use('/api/profile', profileRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin',require('./routes/admin'));
app.use('/api/glimpses', require('./routes/glimpses'));
app.use('/api/aura-requests', require('./routes/auraRequests'));

// Only authenticated participants may receive a conversation's live events.
io.use(async (socket, next) => {
  try {
    socket.userId = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET).userId;
    const account=await db.query('SELECT banned_at,auth_version FROM users WHERE id=$1',[socket.userId]);
    const decoded=jwt.verify(socket.handshake.auth?.token,process.env.JWT_SECRET);
    socket.authVersion=decoded.version||0;
    if(!account.rowCount||account.rows[0].banned_at||(decoded.version||0)!==account.rows[0].auth_version)return next(new Error('Account unavailable.'));
    next();
  } catch { next(new Error('Authentication required.')); }
});
io.on('connection', socket => {
  require('./conversationSocket').registerConversationSocket(socket);
});

require('./reportEvidence').startEvidenceCleanup();
require('./auraFarming').startSignalCleanup();

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 AURA server running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api`);
});

module.exports = { app, server, io };

