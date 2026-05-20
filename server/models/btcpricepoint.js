module.exports = (sequelize, DataTypes) => {
  const BtcPricePoint = sequelize.define('BtcPricePoint', {
    daily_metric_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: {
        model: 'DailyMetrics',
        key: 'id',
      },
    },
    coin_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Coins',
        key: 'id',
      },
    },
    symbol: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'BTCUSDT',
    },
    market: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'binance_usdm_perpetual',
    },
    published_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    kline_open_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    kline_close_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    close_price: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
  }, {
    timestamps: true,
    indexes: [
      { fields: ['coin_id'] },
      { fields: ['daily_metric_id'], unique: true },
      { fields: ['symbol', 'published_at'] },
    ],
  });

  BtcPricePoint.associate = function(models) {
    BtcPricePoint.belongsTo(models.Coin, {
      foreignKey: 'coin_id',
      as: 'coin',
    });
    BtcPricePoint.belongsTo(models.DailyMetric, {
      foreignKey: 'daily_metric_id',
      as: 'dailyMetric',
    });
  };

  return BtcPricePoint;
};
