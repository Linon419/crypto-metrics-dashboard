'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('OptionTunings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      date: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      timestamp: {
        allowNull: true,
        type: Sequelize.DATE,
        comment: 'Precise timestamp for the option tuning note',
      },
      time_precision: {
        allowNull: false,
        defaultValue: 'day',
        type: Sequelize.ENUM('day', 'hour', 'minute'),
        comment: 'Precision level of the option tuning note',
      },
      delta_target: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      vega_target: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      strategy: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      raw_text: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex('OptionTunings', ['date', 'timestamp'], {
      unique: true,
      name: 'option_tunings_unique_date_timestamp',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('OptionTunings');
  },
};
