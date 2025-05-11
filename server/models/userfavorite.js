// models/userfavorite.js
module.exports = (sequelize, DataTypes) => {
    const UserFavorite = sequelize.define('UserFavorite', {
      device_id: {
        type: DataTypes.STRING,
        allowNull: false
      },
      symbol: {
        type: DataTypes.STRING,
        allowNull: false
      }
    }, {
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ['device_id', 'symbol'] // 确保每个设备的每个币种只能收藏一次
        }
      ]
    });
    
    return UserFavorite;
  };