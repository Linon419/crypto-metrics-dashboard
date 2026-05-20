module.exports = (sequelize, DataTypes) => {
  const DatabasePatchLog = sequelize.define('DatabasePatchLog', {
    patch_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    mode: {
      type: DataTypes.ENUM('dry-run', 'apply'),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('success', 'failed'),
      allowNull: false,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    operations_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    matched_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    applied_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    requested_by: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    request_ip: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    patch_json: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    result_json: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    timestamps: true,
  });

  return DatabasePatchLog;
};
