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
    },
    momentum_indicators: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'JSON array of momentum indicator symbols: $, ※, ‼, ↑, w'
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Precise timestamp for the metric data'
    },
    time_precision: {
      type: DataTypes.ENUM('day', 'hour', 'minute'),
      defaultValue: 'day',
      allowNull: false,
      comment: 'Precision level of the time data'
    }
  }, {
    timestamps: true, // 使用默认的 createdAt 和 updatedAt
    // 这张表此前没有任何索引，而它是全站最热的表：
    // 质量评估对每个币种做一年期回看，/api/data/latest 又为每个币种各查一次，
    // 叠加后每个请求都在做几十次全表扫描。
    indexes: [
      { fields: ['coin_id', 'date'], name: 'daily_metrics_coin_id_date' },
      { fields: ['date'], name: 'daily_metrics_date' },
    ],
  });

  DailyMetric.associate = function(models) {
    DailyMetric.belongsTo(models.Coin, {
      foreignKey: 'coin_id',
      as: 'coin'
    });
    DailyMetric.hasOne(models.BtcPricePoint, {
      foreignKey: 'daily_metric_id',
      as: 'btcPricePoint'
    });
  };
  
  return DailyMetric;
};
