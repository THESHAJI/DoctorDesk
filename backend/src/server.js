require('dotenv').config();

const app = require('./app');
const db = require('./models');
const { startReminderJob, stopReminderJob } = require('./jobs/reminder.job');

const PORT = process.env.PORT || 5001;

// ========================
// VALIDATE ENVIRONMENT
// ========================
const requiredEnvVars = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
];
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('Please check your .env file');
  process.exit(1);
}

// ========================
// VALIDATE JWT_EXPIRES_IN FORMAT
// ========================
// Fail fast at startup if JWT_EXPIRES_IN is an invalid or ambiguous
// duration string. parseDuration() uses the same `ms` library that
// jsonwebtoken uses internally, so this catches format errors before
// the first request instead of causing a 500 on first login.
const { parseDuration } = require('./utils/cookieHelper');
try {
  const cookieMaxAgeMs = parseDuration(process.env.JWT_EXPIRES_IN);
  console.log(
    `✅ JWT_EXPIRES_IN="${process.env.JWT_EXPIRES_IN}" → token/cookie lifetime: ${
      cookieMaxAgeMs / 1000
    }s`
  );
} catch (err) {
  console.error(`❌ Invalid JWT_EXPIRES_IN: ${err.message}`);
  console.error('Use a unit-suffixed value like "7d", "24h", "60m", or "3600s".');
  process.exit(1);
}

// ========================
// PRODUCTION-ONLY VALIDATION
// ========================
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  console.error('❌ Missing required environment variable: FRONTEND_URL (required in production for CORS)');
  process.exit(1);
}

// ========================
// START SERVER
// ========================
const startServer = async () => {
  try {
    // Test database connection
    await db.sequelize.authenticate();
    console.log('✅ Database connection established successfully');

    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 DoctorDesk API server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 API URL: http://localhost:${PORT}/api`);
      console.log(`💚 Health check: http://localhost:${PORT}/api/health`);

      // Start background cron jobs in non-test environments
      startReminderJob();
    });
  } catch (error) {
    console.error('❌ Unable to start server:', error.message);
    if (error.message.includes('ECONNREFUSED')) {
      console.error('💡 Is PostgreSQL running? Check your database connection settings.');
    }
    process.exit(1);
  }
};

startServer();

// ========================
// GRACEFUL SHUTDOWN
// ========================
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Shutting down gracefully...');
  stopReminderJob();
  await db.sequelize.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT. Shutting down gracefully...');
  stopReminderJob();
  await db.sequelize.close();
  process.exit(0);
});
