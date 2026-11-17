'use strict';

const readline = require('readline');
const { sequelize, User } = require('../src/models');
const { ROLES } = require('../src/config/constants');

const ask = (question, hidden = false) => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    reject(new Error('Run this command in an interactive terminal so the password can be entered securely.'));
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(question);

  let answer = '';
  const cleanup = () => {
    process.stdin.removeListener('keypress', onKeypress);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
  };

  const onKeypress = (character, key = {}) => {
    if (key.ctrl && key.name === 'c') {
      cleanup();
      reject(new Error('Admin creation cancelled.'));
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      cleanup();
      resolve(answer);
      return;
    }

    if (key.name === 'backspace') {
      answer = answer.slice(0, -1);
      if (!hidden) process.stdout.write('\b \b');
      return;
    }

    if (character && !key.ctrl && !key.meta) {
      answer += character;
      if (!hidden) process.stdout.write(character);
    }
  };

  process.stdin.on('keypress', onKeypress);
});

const createInitialAdmin = async () => {
  const name = (await ask('Administrator name: ')).trim();
  const email = (await ask('Administrator email: ')).trim().toLowerCase();
  const password = await ask('Administrator password (input hidden): ', true);
  const confirmation = await ask('Confirm password (input hidden): ', true);

  if (name.length < 2 || name.length > 100) {
    throw new Error('Name must be between 2 and 100 characters.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  if (password.length < 14) {
    throw new Error('Use a unique administrator password with at least 14 characters.');
  }
  if (password !== confirmation) {
    throw new Error('Passwords do not match.');
  }

  await sequelize.authenticate();

  const admin = await sequelize.transaction(async (transaction) => {
    await sequelize.query('SELECT pg_advisory_xact_lock(1431076397)', { transaction });

    const existingAdminCount = await User.count({
      where: { role: ROLES.ADMIN },
      transaction,
    });

    if (existingAdminCount > 0) {
      throw new Error('An administrator already exists. This command only creates the first admin.');
    }

    return User.create(
      {
        name,
        email,
        password_hash: password,
        role: ROLES.ADMIN,
        is_active: true,
      },
      { transaction }
    );
  });

  console.log(`Created the initial administrator account for ${admin.email}.`);
};

createInitialAdmin()
  .catch((error) => {
    console.error(`Admin creation failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
