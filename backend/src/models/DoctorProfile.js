const { Model, DataTypes } = require('sequelize');
const { DOCTOR_STATUS } = require('../config/constants');

module.exports = (sequelize) => {
  class DoctorProfile extends Model {}

  DoctorProfile.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: { msg: 'Doctor profile already exists for this user' },
        references: {
          model: 'users',
          key: 'id',
        },
      },
      specialization: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'Specialization is required' },
        },
      },
      qualification: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'Qualification is required' },
        },
      },
      consultation_fee: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          isDecimal: { msg: 'Consultation fee must be a valid number' },
          min: { args: [0], msg: 'Consultation fee cannot be negative' },
        },
      },
      bio: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(
          DOCTOR_STATUS.PENDING,
          DOCTOR_STATUS.APPROVED,
          DOCTOR_STATUS.REJECTED,
          DOCTOR_STATUS.SUSPENDED
        ),
        allowNull: false,
        defaultValue: DOCTOR_STATUS.PENDING,
      },
      approved_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      approved_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rejection_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      suspension_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      reviewed_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'DoctorProfile',
      tableName: 'doctor_profiles',
      underscored: true,
      timestamps: true,
    }
  );

  return DoctorProfile;
};
