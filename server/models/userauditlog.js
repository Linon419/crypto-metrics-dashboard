module.exports = (sequelize, DataTypes) => {
  const UserAuditLog = sequelize.define('UserAuditLog', {
    actor_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    actor_username: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    target_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    target_username: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    action: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    ip_address: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
  }, {
    timestamps: true,
    indexes: [
      {
        fields: ['action', 'createdAt'],
        name: 'user_audit_logs_action_created_at',
      },
      {
        fields: ['target_user_id', 'createdAt'],
        name: 'user_audit_logs_target_created_at',
      },
    ],
  });

  return UserAuditLog;
};
