const { Model, DataTypes, Op } = require('sequelize');
const { NOTIFICATION_TYPES } = require('../config/constants');

module.exports = (sequelize) => {
  class Notification extends Model {}

  Notification.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      appointment_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'appointments',
          key: 'id',
        },
      },
      type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
          isIn: {
            args: [Object.values(NOTIFICATION_TYPES)],
            msg: 'Invalid notification type',
          },
        },
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      is_read: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_sent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      scheduled_for: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      sent_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Notification',
      tableName: 'notifications',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          fields: ['user_id', 'is_read'],
          name: 'idx_notifications_user_read',
        },
        {
          fields: ['is_sent', 'scheduled_for'],
          name: 'idx_notifications_scheduler',
        },
        {
          unique: true,
          fields: ['user_id', 'appointment_id', 'type'],
          where: {
            appointment_id: { [Op.ne]: null },
          },
          name: 'unique_appointment_notification_type',
        },
      ],
    }
  );

  return Notification;
};
