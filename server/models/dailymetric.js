// models/dailyMetric.js
module.exports = (sequelize, DataTypes) => {
  const DailyMetric = sequelize.define('DailyMetric', {
    coin_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Coins',
        key: 'id'
      }
    },
    date: {
      type: DataTypes.STRING,
      allowNull: false
    },
    otc_index: {
      type: DataTypes.INTEGER
    },
    explosion_index: {
      type: DataTypes.INTEGER
    },
    schelling_point: {
      type: DataTypes.FLOAT
    },
    entry_exit_type: {
      type: DataTypes.STRING
    },
    entry_exit_day: {
      type: DataTypes.INTEGER
    },
    near_threshold: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    timestamps: true // 使用默认的 createdAt 和 updatedAt
  });
  
  DailyMetric.associate = function(models) {
    DailyMetric.belongsTo(models.Coin, {
      foreignKey: 'coin_id',
      as: 'coin'
    });
  };
  
  return DailyMetric;
};