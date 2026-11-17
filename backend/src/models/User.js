const { Model, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/constants');

module.exports = (sequelize) => {
  class User extends Model {
    // Instance method to check password validity
    async comparePassword(candidatePassword) {
      return bcrypt.compare(candidatePassword, this.password_hash);
    }

    // Sanitize user object for responses
    toJSON() {
      const values = { ...this.get() };
      delete values.password_hash;
      return values;
    }
  }

  User.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'Name is required' },
          len: { args: [2, 100], msg: 'Name must be 2-100 characters' },
        },
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: { msg: 'Email is already registered' },
        validate: {
          isEmail: { msg: 'Must be a valid email address' },
          notEmpty: { msg: 'Email is required' },
        },
      },
      phone: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'Password is required' },
        },
      },
      role: {
        type: DataTypes.ENUM(ROLES.PATIENT, ROLES.DOCTOR, ROLES.ADMIN),
        allowNull: false,
        defaultValue: ROLES.PATIENT,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      timestamps: true,
      hooks: {
        beforeSave: async (user) => {
          if (user.changed('password_hash') && !user.password_hash.startsWith('$2a$') && !user.password_hash.startsWith('$2b$')) {
            const salt = await bcrypt.genSalt(10);
            user.password_hash = await bcrypt.hash(user.password_hash, salt);
          }
        },
      },
    }
  );

  return User;
};
