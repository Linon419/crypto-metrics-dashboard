module.exports = (sequelize, DataTypes) => {
  const AppSetting = sequelize.define('AppSetting', {
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    timestamps: true,
    indexes: [
      {
        fields: ['key'],
        unique: true,
        name: 'app_settings_unique_key',
      },
    ],
  });

  return AppSetting;
};
