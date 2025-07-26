// models/userfavorite.js
module.exports = (sequelize, DataTypes) => {
    const UserFavorite = sequelize.define('UserFavorite', {
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true, // 允许为空，以支持未登录用户的收藏
        references: {
          model: 'Users',
          key: 'id'
        }
      },
      device_id: {
        type: DataTypes.STRING,
        allowNull: true // 现在也允许为空，因为已登录用户可能不需要device_id
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
          fields: ['user_id', 'symbol'],
          name: 'unique_user_symbol',
          where: {
            user_id: {
              [sequelize.Sequelize.Op.ne]: null
            }
          }
        },
        {
          unique: true,
          fields: ['device_id', 'symbol'],
          name: 'unique_device_symbol_when_no_user',
          where: {
            user_id: null
          }
        }
      ]
    });

    // 定义关联关系
    UserFavorite.associate = function(models) {
      UserFavorite.belongsTo(models.User, {
        foreignKey: 'user_id',
        as: 'user'
      });
    };

    return UserFavorite;
  };