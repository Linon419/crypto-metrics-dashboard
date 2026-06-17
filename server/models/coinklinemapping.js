module.exports = (sequelize, DataTypes) => {
  const CoinKlineMapping = sequelize.define('CoinKlineMapping', {
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
    market: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    trading_symbol: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    timestamps: true,
    indexes: [
      {
        fields: ['coin_id'],
        unique: true,
        name: 'coin_kline_mappings_unique_coin_id',
      },
      {
        fields: ['coin_symbol'],
        name: 'coin_kline_mappings_coin_symbol',
      },
      {
        fields: ['market', 'trading_symbol'],
        name: 'coin_kline_mappings_market_trading_symbol',
      },
    ],
  });

  CoinKlineMapping.associate = function(models) {
    CoinKlineMapping.belongsTo(models.Coin, {
      foreignKey: 'coin_id',
      as: 'coin',
    });
  };

  return CoinKlineMapping;
};
