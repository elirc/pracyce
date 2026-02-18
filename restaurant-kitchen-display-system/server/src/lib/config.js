const dotenv = require('dotenv');

dotenv.config();

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  port: asNumber(process.env.PORT, 4300),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5177',
  lateAlertPollMs: asNumber(process.env.LATE_ALERT_POLL_MS, 10000)
};