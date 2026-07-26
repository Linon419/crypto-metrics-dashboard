module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    external_id: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    source: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'telegram',
    },
    title: {
      type: DataTypes.STRING(160),
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'market',
    },
    priority: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'normal',
    },
    coin_symbol: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    notification_date: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['user_id', 'external_id'],
        name: 'notifications_unique_user_external_id',
      },
      {
        fields: ['user_id', 'read_at', 'createdAt'],
        name: 'notifications_user_unread_created_at',
      },
    ],
  });

  Notification.associate = function associate(models) {
    Notification.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'user',
      onDelete: 'CASCADE',
    });
  };

  return Notification;
};
