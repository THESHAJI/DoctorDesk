const cron = require('node-cron');
const NotificationService = require('../services/notification.service');

let cronTask = null;
let isProcessing = false;

/**
 * Executes a single run of the reminder dispatcher with concurrency locking
 * and failure logging.
 */
const runReminderCycle = async () => {
  if (isProcessing) {
    return;
  }

  isProcessing = true;
  try {
    const result = await NotificationService.processDueReminders(50);
    if (result.processed > 0) {
      console.log(
        `[CRON REMINDER] Processed ${result.processed} due reminders (${result.sent} sent, ${result.dropped} dropped invalid/cancelled).`
      );
    }
  } catch (error) {
    console.error('[CRON REMINDER ERROR] Failed to process due reminders:', error.message);
  } finally {
    isProcessing = false;
  }
};

/**
 * Starts the reminder cron job (every minute).
 * Disabled in test environments.
 */
const startReminderJob = () => {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  if (cronTask) {
    return cronTask;
  }

  console.log('⏰ Starting Reminder Cron Job (running every minute)...');
  // Runs every minute
  cronTask = cron.schedule('* * * * *', runReminderCycle);
  return cronTask;
};

/**
 * Stops the reminder cron job gracefully
 */
const stopReminderJob = () => {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('🛑 Reminder Cron Job stopped.');
  }
};

module.exports = {
  startReminderJob,
  stopReminderJob,
  runReminderCycle,
};
