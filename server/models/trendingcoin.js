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
    }
  }, {
    timestamps: true
  });
  
  return TrendingCoin;
};