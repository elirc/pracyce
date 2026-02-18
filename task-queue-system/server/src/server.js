const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const config = require('./lib/config');
const { connection } = require('./lib/redis');
const { emailQueue, deadLetterQueue } = require('./queues');

require('./db/database');

const campaignsRoutes = require('./routes/campaigns');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

app.use(
  cors({
    origin: config.clientOrigin
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

const bullBoardAdapter = new ExpressAdapter();
bullBoardAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue), new BullMQAdapter(deadLetterQueue)],
  serverAdapter: bullBoardAdapter
});

app.get('/api/health', async (_req, res) => {
  let redis = 'ok';

  try {
    // Health endpoint must stay responsive even if Redis is unavailable.
    await Promise.race([
      connection.ping(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Redis ping timeout')), 800);
      })
    ]);
  } catch (error) {
    redis = `error: ${error.message}`;
  }

  res.json({
    ok: true,
    redis,
    timestamp: new Date().toISOString()
  });
});

app.use('/api/campaigns', campaignsRoutes);
app.use('/api/dashboard', dashboardRoutes);
// Bull Board gives operators a queue-native view (waiting/active/delayed/failed) beyond DB projections.
app.use('/admin/queues', bullBoardAdapter.getRouter());

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    message: 'Internal server error'
  });
});

app.listen(config.port, () => {
  console.log(`API server listening on http://localhost:${config.port}`);
  console.log(`Bull Board available at http://localhost:${config.port}/admin/queues`);
});
