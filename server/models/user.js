// server/models/user.js
module.exports = (sequelize, DataTypes) => {
    const User = sequelize.define('User', {
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        set(value) {
          this.setDataValue(
            'username',
            typeof value === 'string' ? value.trim().toLowerCase() : value,
          );
        },
        validate: {
          len: [3, 64]
        }
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false
      },
      role: {
        type: DataTypes.STRING,
        defaultValue: 'user',
        allowNull: false,
        validate: {
          isIn: [['user', 'admin']]
        }
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
        allowNull: false,
        validate: {
          isIn: [['active', 'banned', 'inactive']]
        }
      },
      lastLogin: {
        type: DataTypes.DATE,
        allowNull: true
      }
    }, {
      timestamps: true
    });
    
    return User;
  };
