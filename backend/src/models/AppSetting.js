const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class AppSetting extends Model {}

  AppSetting.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      key: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: { msg: 'Setting key must be unique' },
        validate: {
          notEmpty: { msg: 'Setting key is required' },
        },
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'AppSetting',
      tableName: 'app_settings',
      underscored: true,
      timestamps: true,
    }
  );

  return AppSetting;
};
