// server/models/user.js
module.exports = (sequelize, DataTypes) => {
    const User = sequelize.define('User', {
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false
      },
      role: {
        type: DataTypes.STRING,
        defaultValue: 'user'
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        validate: {
          isEmail: true
        }
      },
      status: {
        type: DataTypes.STRING,
        defaultValue: 'active',
        allowNull: false
      }
    }, {
      timestamps: true
    });
    
    return User;
  };