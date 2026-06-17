module.exports = (sequelize, DataTypes) => {
  const OptionTuning = sequelize.define('OptionTuning', {
    date: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Precise timestamp for the option tuning note',
    },
    time_precision: {
      type: DataTypes.ENUM('day', 'hour', 'minute'),
      defaultValue: 'day',
      allowNull: false,
      comment: 'Precision level of the option tuning note',
    },
    delta_target: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    vega_target: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    strategy: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    raw_text: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    timestamps: true,
    indexes: [
      {
        fields: ['date', 'timestamp'],
        unique: true,
        name: 'option_tunings_unique_date_timestamp',
      },
    ],
  });

  return OptionTuning;
};
