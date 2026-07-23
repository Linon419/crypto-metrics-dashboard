// src/components/UserManagement.jsx
import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Button, 
  Modal, 
  Form, 
  Input, 
  Select, 
  message, 
  Popconfirm, 
  Tag, 
  Space, 
  Switch,
  Typography,
  Card,
  Alert,
  Tooltip
} from 'antd';
import {
  UserOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  WarningOutlined,
  LockOutlined,
  UnlockOutlined
} from '@ant-design/icons';
import { 
  getAllUsers, 
  createUser, 
  updateUser, 
  deleteUser, 
  banUser, 
  unbanUser,
  getSystemSettings,
  updateSystemSettings
} from '../services/api';

const { Title, Text } = Typography;
const { Option } = Select;

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form] = Form.useForm();
  const [systemSettings, setSystemSettings] = useState({ registrationEnabled: true });
  const [settingsLoading, setSettingsLoading] = useState(false);

  // 加载用户列表
  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await getAllUsers();
      setUsers(response.users || []);
    } catch (error) {
      message.error('加载用户列表失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 加载系统设置
  const loadSystemSettings = async () => {
    try {
      const response = await getSystemSettings();
      setSystemSettings(response.settings || { registrationEnabled: true });
    } catch (error) {
      console.error('加载系统设置失败:', error);
    }
  };

  useEffect(() => {
    loadUsers();
    loadSystemSettings();
  }, []);

  // 打开创建/编辑用户模态框
  const openModal = (user = null) => {
    setEditingUser(user);
    setModalVisible(true);
    if (user) {
      form.setFieldsValue({
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status
      });
    } else {
      form.resetFields();
    }
  };

  // 提交表单
  const handleSubmit = async (values) => {
    try {
      if (editingUser) {
        // 编辑用户
        await updateUser(editingUser.id, values);
        message.success('用户更新成功');
      } else {
        // 创建用户
        await createUser(values);
        message.success('用户创建成功');
      }
      setModalVisible(false);
      form.resetFields();
      loadUsers();
    } catch (error) {
      message.error(editingUser ? '更新用户失败: ' + error.message : '创建用户失败: ' + error.message);
    }
  };

  // 删除用户
  const handleDelete = async (userId) => {
    try {
      await deleteUser(userId);
      message.success('用户删除成功');
      loadUsers();
    } catch (error) {
      message.error('删除用户失败: ' + error.message);
    }
  };

  // 封禁/解封用户
  const handleBanToggle = async (user) => {
    try {
      if (user.status === 'banned') {
        await unbanUser(user.id);
        message.success('用户已解封');
      } else {
        await banUser(user.id);
        message.success('用户已封禁');
      }
      loadUsers();
    } catch (error) {
      message.error('操作失败: ' + error.message);
    }
  };

  // 切换注册开关
  const handleRegistrationToggle = async (enabled) => {
    setSettingsLoading(true);
    try {
      await updateSystemSettings({ registrationEnabled: enabled });
      setSystemSettings(prev => ({ ...prev, registrationEnabled: enabled }));
      message.success(enabled ? '注册功能已开启' : '注册功能已关闭');
    } catch (error) {
      message.error('更新设置失败: ' + error.message);
    } finally {
      setSettingsLoading(false);
    }
  };

  // 用户状态渲染
  const renderStatus = (status) => {
    const statusConfig = {
      active: { color: 'green', text: '正常' },
      banned: { color: 'red', text: '已封禁' },
      inactive: { color: 'gray', text: '未激活' }
    };
    const config = statusConfig[status] || statusConfig.active;
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  // 用户角色渲染
  const renderRole = (role) => {
    const roleConfig = {
      admin: { color: 'purple', text: '管理员' },
      user: { color: 'blue', text: '普通用户' }
    };
    const config = roleConfig[role] || roleConfig.user;
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  // 表格列定义
  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text, record) => (
        <Space>
          <UserOutlined />
          <span>{text}</span>
          {record.role === 'admin' && <Tag color="gold" size="small">管理员</Tag>}
        </Space>
      ),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: renderRole,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: renderStatus,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (text) => text ? new Date(text).toLocaleDateString() : '-',
    },
    {
      title: '最后登录',
      dataIndex: 'lastLogin',
      key: 'lastLogin',
      render: (text) => text ? new Date(text).toLocaleDateString() : '从未登录',
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space>
          <Tooltip title="编辑用户">
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => openModal(record)}
              size="small"
            />
          </Tooltip>
          
          <Tooltip title={record.status === 'banned' ? '解封用户' : '封禁用户'}>
            <Popconfirm
              title={`确定要${record.status === 'banned' ? '解封' : '封禁'}该用户吗？`}
              onConfirm={() => handleBanToggle(record)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="link"
                icon={record.status === 'banned' ? <UnlockOutlined /> : <LockOutlined />}
                danger={record.status !== 'banned'}
                size="small"
              />
            </Popconfirm>
          </Tooltip>

          <Tooltip title="删除用户">
            <Popconfirm
              title="确定要删除该用户吗？此操作不可恢复！"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
              okType="danger"
            >
              <Button
                type="link"
                icon={<DeleteOutlined />}
                danger
                size="small"
              />
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="user-management">
      <Text type="secondary">ACCESS CONTROL</Text>
      <Title level={3}>
        <UserOutlined className="mr-2" />
        用户管理
      </Title>

      {/* 系统设置卡片 */}
      <Card className="mb-6" title="系统设置">
        <Space direction="vertical" size="middle" className="w-full">
          <div className="flex items-center justify-between">
            <div>
              <Text strong>注册功能</Text>
              <br />
              <Text type="secondary" className="text-sm">
                控制是否允许新用户注册账户
              </Text>
            </div>
            <Switch
              checked={systemSettings.registrationEnabled}
              onChange={handleRegistrationToggle}
              loading={settingsLoading}
              checkedChildren="开启"
              unCheckedChildren="关闭"
            />
          </div>
          
          {!systemSettings.registrationEnabled && (
            <Alert
              message="注册功能已关闭"
              description="新用户无法通过注册页面创建账户，只能由管理员手动添加。"
              type="warning"
              showIcon
              icon={<WarningOutlined />}
            />
          )}
        </Space>
      </Card>

      {/* 用户统计 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card size="small">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{users.length}</div>
            <div className="text-gray-500">总用户数</div>
          </div>
        </Card>
        
        <Card size="small">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {users.filter(u => u.status === 'active').length}
            </div>
            <div className="text-gray-500">正常用户</div>
          </div>
        </Card>
        
        <Card size="small">
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {users.filter(u => u.status === 'banned').length}
            </div>
            <div className="text-gray-500">已封禁</div>
          </div>
        </Card>
        
        <Card size="small">
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">
              {users.filter(u => u.role === 'admin').length}
            </div>
            <div className="text-gray-500">管理员</div>
          </div>
        </Card>
      </div>

      {/* 用户列表 */}
      <Card
        title="用户列表"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openModal()}
          >
            添加用户
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={users}
          loading={loading}
          rowKey="id"
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条记录`,
          }}
        />
      </Card>

      {/* 创建/编辑用户模态框 */}
      <Modal
        title={editingUser ? '编辑用户' : '添加用户'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, message: '用户名至少3个字符' },
              { max: 20, message: '用户名最多20个字符' }
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>

          {!editingUser && (
            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少6个字符' }
              ]}
            >
              <Input.Password placeholder="请输入密码" />
            </Form.Item>
          )}

          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="请选择角色">
              <Option value="user">普通用户</Option>
              <Option value="admin">管理员</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select placeholder="请选择状态">
              <Option value="active">正常</Option>
              <Option value="banned">封禁</Option>
              <Option value="inactive">未激活</Option>
            </Select>
          </Form.Item>

          <Form.Item className="mb-0">
            <Space className="w-full justify-end">
              <Button onClick={() => setModalVisible(false)}>
                取消
              </Button>
              <Button type="primary" htmlType="submit">
                {editingUser ? '更新' : '创建'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default UserManagement;
