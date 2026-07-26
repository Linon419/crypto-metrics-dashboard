const assert = require('assert');
const { Sequelize, DataTypes } = require('sequelize');

const migration = require('../migrations/20260726000002-create-user-audit-logs');
const defineUserAuditLog = require('../models/userauditlog');

async function run() {
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  const queryInterface = sequelize.getQueryInterface();

  await migration.up(queryInterface, Sequelize);
  const tables = await queryInterface.showAllTables();
  assert.ok(tables.includes('UserAuditLogs'));

  const indexes = await queryInterface.showIndex('UserAuditLogs');
  assert.ok(indexes.some(index => index.name === 'user_audit_logs_action_created_at'));
  assert.ok(indexes.some(index => index.name === 'user_audit_logs_target_created_at'));

  const UserAuditLog = defineUserAuditLog(sequelize, DataTypes);
  await UserAuditLog.create({
    actor_user_id: 1,
    actor_username: 'admin',
    target_user_id: 2,
    target_username: 'member',
    action: 'user.ban',
    details: JSON.stringify({ status: 'banned' }),
    ip_address: '127.0.0.1',
  });
  assert.strictEqual(await UserAuditLog.count(), 1);

  await migration.down(queryInterface);
  assert.ok(!(await queryInterface.showAllTables()).includes('UserAuditLogs'));
  await sequelize.close();
  console.log('userAuditMigration.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
