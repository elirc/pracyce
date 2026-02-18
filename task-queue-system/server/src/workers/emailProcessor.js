const WAIT_MIN_MS = 400;
const WAIT_MAX_MS = 1600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulateEmailSend(jobData) {
  // Artificial latency emulates network/provider timing and makes queue state transitions visible.
  const waitTime = Math.floor(Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS + 1)) + WAIT_MIN_MS;
  await sleep(waitTime);

  // Tunable fail rate lets you demo retries and DLQ behavior on demand.
  const failRate = typeof jobData.failRate === 'number' ? jobData.failRate : 0.25;
  const shouldFail = Math.random() < failRate;

  if (shouldFail) {
    const error = new Error(`Transient SMTP error while sending to ${jobData.recipientEmail}`);
    error.code = 'SMTP_TEMP_ERROR';
    throw error;
  }

  return {
    delivered: true,
    recipientEmail: jobData.recipientEmail,
    providerMessageId: `msg_${Math.random().toString(16).slice(2)}`,
    processedAt: new Date().toISOString()
  };
}

module.exports = {
  simulateEmailSend
};
