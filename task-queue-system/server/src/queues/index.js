const { Queue, QueueEvents } = require('bullmq');
const { connection } = require('../lib/redis');

const QUEUE_NAMES = {
  EMAIL: 'email-jobs',
  DEAD_LETTER: 'dead-letter-jobs'
};

// Default options define the reliability contract for every email job unless overridden at enqueue time.
const emailQueue = new Queue(QUEUE_NAMES.EMAIL, {
  connection,
  defaultJobOptions: {
    attempts: 4,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: {
      age: 3600,
      count: 5000
    },
    removeOnFail: {
      age: 24 * 3600,
      count: 5000
    }
  }
});

const deadLetterQueue = new Queue(QUEUE_NAMES.DEAD_LETTER, {
  connection,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false
  }
});

const emailQueueEvents = new QueueEvents(QUEUE_NAMES.EMAIL, { connection });

module.exports = {
  QUEUE_NAMES,
  emailQueue,
  deadLetterQueue,
  emailQueueEvents
};
