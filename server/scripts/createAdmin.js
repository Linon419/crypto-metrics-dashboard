// server/scripts/createAdmin.js
const bcrypt = require('bcryptjs');
const { User } = require('../models'); // 确保 User 模型和 Sequelize 连接已正确初始化

async function createInitialAdmin() {
  try {
    // 检查管理员是否已存在
    const existingAdmin = await User.findOne({
      where: { username: 'admin' } // 按用户名查找
    });
    
    if (existingAdmin) {
      console.log('Admin user already exists');
      return; // 如果已存在，则不执行任何操作并退出
    }
    
    // 创建管理员用户
    const salt = await bcrypt.genSalt(10); // 生成盐
    const hashedPassword = await bcrypt.hash('admin123', salt); // 哈希密码
    
    await User.create({
      username: 'admin',
      password: hashedPassword,
      role: 'admin', // 假设 User 模型有 role 字段
      email: 'admin@example.com' // 提供一个示例邮箱
    });
    
    console.log('Admin user created successfully');
    console.log('Username: admin');
    console.log('Password: admin123'); // 提示默认密码
    console.log('Please change this password immediately after first login!'); // 安全提示
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    // 确保在脚本执行完毕后关闭数据库连接（如果 Sequelize 实例没有自动关闭）
    // 对于简单的脚本，通常 Sequelize 会在 Node.js 进程结束时处理连接。
    // 如果遇到连接未关闭的问题，可能需要显式调用 sequelize.close()
    // const { sequelize } = require('../models'); // 如果需要显式关闭
    // await sequelize.close();
    process.exit(); // 退出脚本进程
  }
}

createInitialAdmin();