// src/components/Register.jsx
import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Alert, Space } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { register as registerApi, getSystemSettings } from '../services/api';
import { registerStart, registerSuccess, registerFailure, clearError } from '../redux/slices/authSlice';

const { Title, Text } = Typography;

function Register() {
  const [form] = Form.useForm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { loading, error, isAuthenticated } = useSelector(state => state.auth);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  
  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  // Check if registration is enabled
  useEffect(() => {
    const checkRegistrationStatus = async () => {
      try {
        const response = await getSystemSettings();
        setRegistrationEnabled(response.settings?.registrationEnabled ?? true);
      } catch (error) {
        console.error('获取注册状态失败:', error);
        // 默认允许注册，避免因API错误导致无法注册
        setRegistrationEnabled(true);
      } finally {
        setSettingsLoading(false);
      }
    };

    checkRegistrationStatus();
  }, []);
  
  // Clear error when component unmounts
  useEffect(() => {
    return () => {
      dispatch(clearError());
    };
  }, [dispatch]);
  
  const handleSubmit = async (values) => {
    if (values.password !== values.confirmPassword) {
      form.setFields([
        {
          name: 'confirmPassword',
          errors: ['两次输入的密码不一致']
        }
      ]);
      return;
    }
    
    try {
      dispatch(registerStart());
      const data = await registerApi({
        username: values.username,
        password: values.password,
        email: values.email
      });
      dispatch(registerSuccess(data));
      navigate('/dashboard');
    } catch (error) {
      dispatch(registerFailure(error.error || 'Registration failed'));
    }
  };
  
  // 如果正在加载设置，显示加载状态
  if (settingsLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-100">
        <Card className="w-full max-w-md">
          <div className="text-center p-8">
            <Title level={2}>加密货币指标看板</Title>
            <Text type="secondary">正在检查注册状态...</Text>
          </div>
        </Card>
      </div>
    );
  }

  // 如果注册被禁用，显示提示信息
  if (!registrationEnabled) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-100">
        <Card className="w-full max-w-md">
          <div className="text-center mb-6">
            <Title level={2}>加密货币指标看板</Title>
            <Text type="secondary">用户注册</Text>
          </div>
          
          <Alert
            message="注册功能已关闭"
            description="系统管理员已关闭新用户注册功能，如需账号请联系管理员。"
            type="warning"
            showIcon
            className="mb-4"
          />
          
          <div className="text-center">
            <Button type="primary" onClick={() => navigate('/login')}>
              返回登录
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100">
      <Card className="w-full max-w-md">
        <div className="text-center mb-6">
          <Title level={2}>加密货币指标看板</Title>
          <Text type="secondary">注册新账号</Text>
        </div>
        
        {error && (
          <Alert
            message="注册失败"
            description={error}
            type="error"
            showIcon
            closable
            className="mb-4"
            onClose={() => dispatch(clearError())}
          />
        )}
        
        <Form
          form={form}
          name="register"
          onFinish={handleSubmit}
          layout="vertical"
        >
          <Form.Item
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, message: '用户名至少3个字符' }
            ]}
          >
            <Input
              prefix={<UserOutlined className="site-form-item-icon" />}
              placeholder="用户名"
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="email"
            rules={[
              { type: 'email', message: '请输入有效的电子邮箱' }
            ]}
          >
            <Input
              prefix={<MailOutlined className="site-form-item-icon" />}
              placeholder="电子邮箱 (可选)"
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少6个字符' }
            ]}
          >
            <Input.Password
              prefix={<LockOutlined className="site-form-item-icon" />}
              placeholder="密码"
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined className="site-form-item-icon" />}
              placeholder="确认密码"
              size="large"
            />
          </Form.Item>
          
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              className="w-full"
              size="large"
            >
              注册
            </Button>
          </Form.Item>
          
          <div className="text-center">
            <Space>
              <Button type="link" onClick={() => navigate('/login')}>
                已有账号？登录
              </Button>
            </Space>
          </div>
        </Form>
      </Card>
    </div>
  );
}

export default Register;