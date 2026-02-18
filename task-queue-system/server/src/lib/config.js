const dotenv = require('dotenv');

dotenv.config();

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = {
  port: asNumber(process.env.PORT, 4100),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5175',
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: asNumber(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: asNumber(process.env.REDIS_DB, 0)
  },
  workerConcurrency: asNumber(process.env.WORKER_CONCURRENCY, 8)
};

module.exports = config;