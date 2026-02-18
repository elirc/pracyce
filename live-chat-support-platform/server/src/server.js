const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { Server } = require('socket.io');
const config = require('./lib/config');

require('./db/database');

const apiRouter = require('./routes/api');
const { createSocketServer } = require('./socket');

const app = express();

app.use(
  cors({
    origin: config.clientOrigin
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString()
  });
});

app.use('/api', apiRouter);

const server = http.createServer(app);

// REST + Socket.IO share one HTTP server so uploads/API and realtime events stay on one origin.
const io = new Server(server, {
  cors: {
    origin: config.clientOrigin
  }
});

const socketServer = createSocketServer(io);
// REST route layer can reuse live presence data without duplicating socket tracking logic.
app.locals.getOnlineCount = socketServer.getOnlineCount;

server.listen(config.port, () => {
  console.log(`Live chat server listening on http://localhost:${config.port}`);
});
