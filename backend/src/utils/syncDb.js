require('dotenv').config();
const db = require('../models');

/**
 * Diagnostic and programmatic DB check utility.
 * Can be run via: node src/utils/syncDb.js
 */
async function verifyDatabase() {
  console.log('🔍 Testing PostgreSQL connection...');
  try {
    await db.sequelize.authenticate();
    console.log('✅ Connection to PostgreSQL successful!');

    console.log('📊 Verifying registered models:');
    const modelNames = Object.keys(db.sequelize.models);
    modelNames.forEach((name) => console.log(`   - ${name}`));

    console.log(`\nTotal registered models: ${modelNames.length} / 10`);

    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    if (error.original && error.original.code === 'ECONNREFUSED') {
      console.error('💡 PostgreSQL service is not running or not listening on port 5432.');
    }
    return false;
  } finally {
    await db.sequelize.close();
  }
}

if (require.main === module) {
  verifyDatabase();
}

module.exports = verifyDatabase;
