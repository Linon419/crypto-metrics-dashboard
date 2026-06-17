module.exports = (sequelize, DataTypes) => {
  const CoinKline = sequelize.define('CoinKline', {
    coin_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Coins',
        key: 'id',
      },
    },
    coin_symbol: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    trading_symbol: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    market: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'binance_usdm_perpetual',
    },
    interval: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '1d',
    },
    open_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    close_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    open_price: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    high_price: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    low_price: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    close_price: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    volume: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    quote_volume: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    trade_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  }, {
    timestamps: true,
    indexes: [
      { fields: ['coin_id', 'interval', 'open_time'] },
      {
        fields: ['trading_symbol', 'market', 'interval', 'open_time'],
        name: 'coin_klines_trading_symbol_market_interval_open_time',
      },
      {
        fields: ['coin_id', 'market', 'interval', 'open_time'],
        unique: true,
        name: 'coin_klines_unique_coin_market_interval_open_time',
      },
    ],
  });

  CoinKline.associate = function(models) {
    CoinKline.belongsTo(models.Coin, {
      foreignKey: 'coin_id',
      as: 'coin',
    });
  };

  return CoinKline;
};
