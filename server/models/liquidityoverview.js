// models/liquidityOverview.js
module.exports = (sequelize, DataTypes) => {
  const LiquidityOverview = sequelize.define('LiquidityOverview', {
    date: {
      type: DataTypes.STRING,
      allowNull: false
    },
    btc_fund_change: {
      type: DataTypes.FLOAT
    },
    eth_fund_change: {
      type: DataTypes.FLOAT
    },
    sol_fund_change: {
      type: DataTypes.FLOAT
    },
    total_market_fund_change: {
      type: DataTypes.FLOAT
    },
    comments: {
      type: DataTypes.TEXT
    },
    daily_reminder: {
      type: DataTypes.TEXT
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Precise timestamp for the liquidity data'
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
  
  return LiquidityOverview;
};