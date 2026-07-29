const assert = require('assert');
const bcrypt = require('bcryptjs');

const {
  createManagedUser,
  deleteManagedUser,
  listUserAuditLogs,
  setManagedUserStatus,
  updateManagedUser,
} = require('../services/userManagementService');

function createRow(values) {
  return {
    ...values,
    async update(payload) {
      Object.assign(this, payload);
      return this;
    },
    async destroy() {
      this.destroyed = true;
      return 1;
    },
    get() {
      return this;
    },
  };
}

function createModels() {
  const users = [
    createRow({
      id: 1,
      username: 'owner',
      email: 'owner@example.com',
      password: bcrypt.hashSync('owner secure passphrase', 10),
      role: 'admin',
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
    createRow({
      id: 2,
      username: 'member',
      email: 'member@example.com',
      password: bcrypt.hashSync('member secure passphrase', 10),
      role: 'user',
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
  ];
  const auditRows = [];

  const UserModel = {
    async findAll() {
      return users.filter(user => !user.destroyed);
    },
    async findByPk(id) {
      return users.find(user => user.id === Number(id) && !user.destroyed) || null;
    },
    async findOne({ where }) {
      return users.find(user => {
        if (where.username && user.username !== where.username) return false;
        if (where.email && user.email !== where.email) return false;
        return !user.destroyed;
      }) || null;
    },
    async count({ where }) {
      return users.filter(user => (
        !user.destroyed
        && user.role === where.role
        && user.status === where.status
      )).length;
    },
    async create(payload) {
      const user = createRow({
        id: users.length + 1,
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      users.push(user);
      return user;
    },
  };
  const UserAuditLogModel = {
    async create(payload) {
      const row = createRow({ id: auditRows.length + 1, ...payload, createdAt: new Date() });
      auditRows.push(row);
      return row;
    },
    async findAll({ limit }) {
      return auditRows.slice().reverse().slice(0, limit);
    },
  };
  const SequelizeInstance = {
    async transaction(callback) {
      return callback({ id: 'transaction' });
    },
  };

  return { users, auditRows, UserModel, UserAuditLogModel, SequelizeInstance };
}

async function run() {
  const models = createModels();
  const actor = { id: 1, username: 'owner', role: 'admin', status: 'active' };

  await assert.rejects(
    () => updateManagedUser(models, actor, 1, { role: 'user' }),
    error => error.statusCode === 400 && /自己/.test(error.message)
  );
  await assert.rejects(
    () => updateManagedUser(models, actor, 2, { role: 'superadmin' }),
    error => error.statusCode === 400 && /角色/.test(error.message)
  );
  await assert.rejects(
    () => setManagedUserStatus(models, actor, 1, 'banned'),
    error => error.statusCode === 400 && /自己/.test(error.message)
  );
  await assert.rejects(
    () => deleteManagedUser(models, actor, 1),
    error => error.statusCode === 400 && /自己/.test(error.message)
  );

  const created = await createManagedUser(models, actor, {
    username: 'Second-Admin',
    email: 'second-admin@example.com',
    password: 'second admin passphrase',
    role: 'admin',
    status: 'active',
  });
  assert.strictEqual(created.user.role, 'admin');
  assert.strictEqual(created.user.username, 'second-admin');
  assert.notStrictEqual(models.users[2].password, 'second admin passphrase');

  const updated = await updateManagedUser(models, actor, 2, {
    username: 'member-renamed',
    email: 'member-renamed@example.com',
    role: 'user',
    status: 'inactive',
  });
  assert.strictEqual(updated.user.status, 'inactive');

  const banned = await setManagedUserStatus(models, actor, 3, 'banned');
  assert.strictEqual(banned.user.status, 'banned');
  await deleteManagedUser(models, actor, 2);

  assert.deepStrictEqual(models.auditRows.map(row => row.action), [
    'user.create',
    'user.update',
    'user.ban',
    'user.delete',
  ]);
  const audit = await listUserAuditLogs(models, { limit: 20 });
  assert.strictEqual(audit.auditLogs.length, 4);

  console.log('userAdminSecurity.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
