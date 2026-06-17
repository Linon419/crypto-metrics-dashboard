// models/coin.js
module.exports = (sequelize, DataTypes) => {
  const Coin = sequelize.define('Coin', {
    symbol: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    current_price: {
      type: DataTypes.FLOAT
    },
    logo_url: {
      type: DataTypes.STRING
    }
  }, {
    timestamps: true // 使用默认的 createdAt 和 updatedAt
  });
  
  Coin.associate = function(models) {
    Coin.hasMany(models.DailyMetric, {
      foreignKey: 'coin_id',
      as: 'metrics'
    });
    Coin.hasMany(models.BtcPricePoint, {
      foreignKey: 'coin_id',
      as: 'btcPricePoints'
    });
    Coin.hasMany(models.CoinKline, {
      foreignKey: 'coin_id',
      as: 'klines'
    });
    Coin.hasOne(models.CoinKlineMapping, {
      foreignKey: 'coin_id',
      as: 'klineMapping'
    });
  };
  
  return Coin;
};
