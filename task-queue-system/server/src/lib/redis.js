const IORedis = require('ioredis');
const config = require('./config');

const connection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false
});

// Log connection issues loudly: queue APIs can still start, but enqueue/worker operations will degrade.
connection.on('error', (error) => {
  console.error('[redis] connection error:', error.message);
});

module.exports = {
  connection
};
