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
    }
  }, {
    timestamps: true
  });
  
  return LiquidityOverview;
};