const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./lib/config');

require('./db/database');

const { createApiRouter } = require('./routes/api');
const { refreshLateFlags } = require('./lib/kdsService');

const app = express();

app.use(
  cors({
    origin: config.clientOrigin
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.clientOrigin
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use('/api', createApiRouter(io));

let lastLateSignature = '';
setInterval(() => {
  const late = refreshLateFlags();
  const signature = late.map((entry) => entry.id).join('|');
  if (signature !== lastLateSignature) {
    lastLateSignature = signature;
    io.emit('kds_event', {
      type: 'late_alerts_changed',
      payload: late,
      timestamp: new Date().toISOString()
    });
  }
}, Math.max(3000, config.lateAlertPollMs));

io.on('connection', (socket) => {
  socket.emit('kds_event', {
    type: 'connected',
    payload: { socketId: socket.id },
    timestamp: new Date().toISOString()
  });
});

server.listen(config.port, () => {
  console.log(`KDS server listening on http://localhost:${config.port}`);
});