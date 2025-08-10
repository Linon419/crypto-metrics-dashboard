// models/trendingCoin.js
module.exports = (sequelize, DataTypes) => {
  const TrendingCoin = sequelize.define('TrendingCoin', {
    date: {
      type: DataTypes.STRING,
      allowNull: false
    },
    symbol: {
      type: DataTypes.STRING,
      allowNull: false
    },
    otc_index: {
      type: DataTypes.INTEGER
    },
    explosion_index: {
      type: DataTypes.INTEGER
    },
    entry_exit_type: {
      type: DataTypes.STRING
    },
    entry_exit_day: {
      type: DataTypes.INTEGER
    },
    schelling_point: {
      type: DataTypes.FLOAT
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Precise timestamp for the trending coin data'
    },
    time_precision: {
      type: DataTypes.ENUM('day', 'hour', 'minute'),
      defaultValue: 'day',
      allowNull: false,
      comment: 'Precision level of the time data'
    }
  }, {
    timestamps: true
  });
  
  return TrendingCoin;
};