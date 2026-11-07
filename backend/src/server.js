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
app.use('/api/glimpses', require('./routes/glimpses'));
app.use('/api/aura-requests', require('./routes/auraRequests'));

// Only authenticated participants may receive a conversation's live events.
io.use((socket, next) => {
  try {
    socket.userId = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET).userId;
    next();
  } catch { next(new Error('Authentication required.')); }
});
io.on('connection', socket => {
  socket.on('join:match', async input => {
    const matchId = Number(typeof input === 'object' ? input?.matchId : input);
    if (!Number.isInteger(matchId) || matchId <= 0) return;
    try {
      const member = await db.query('SELECT id FROM matches WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)', [matchId,socket.userId]);
      if (member.rowCount) socket.join(`match:${matchId}`);
    } catch (error) { console.error('Join conversation error:',error.message); }
  });
  socket.on('typing', data => {
    const room = `match:${Number(data?.matchId)}`;
    if (socket.rooms.has(room)) socket.to(room).emit('typing', { matchId: Number(data.matchId), userId: socket.userId });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 AURA server running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api`);
});

module.exports = { app, server, io };

