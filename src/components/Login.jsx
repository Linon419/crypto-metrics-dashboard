// src/components/Login.jsx
import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Alert, Space } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { login as loginApi } from '../services/api';
import { loginStart, loginSuccess, loginFailure, clearError } from '../redux/slices/authSlice';

const { Title, Text } = Typography;

function Login() {
  const [form] = Form.useForm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { loading, error, isAuthenticated } = useSelector(state => state.auth);
  
  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);
  
  // Clear error when component unmounts
  useEffect(() => {
    return () => {
      dispatch(clearError());
    };
  }, [dispatch]);
  
  const handleSubmit = async (values) => {
    try {
      dispatch(loginStart());
      const data = await loginApi(values);
      dispatch(loginSuccess(data));
      navigate('/dashboard');
    } catch (error) {
      dispatch(loginFailure(error.error || 'Login failed'));
    }
  };
  
  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100">
      <Card className="w-full max-w-md">
        <div className="text-center mb-6">
          <Title level={2}>加密货币指标看板</Title>
          <Text type="secondary">登录以访问系统</Text>
        </div>
        
        {error && (
          <Alert
            message="登录失败"
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
          name="login"
          onFinish={handleSubmit}
          layout="vertical"
        >
          <Form.Item
            name="username"
            rules={[
              { required: true, message: '请输入用户名' }
            ]}
          >
            <Input
              prefix={<UserOutlined className="site-form-item-icon" />}
              placeholder="用户名"
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="password"
            rules={[
              { required: true, message: '请输入密码' }
            ]}
          >
            <Input.Password
              prefix={<LockOutlined className="site-form-item-icon" />}
              placeholder="密码"
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
              登录
            </Button>
          </Form.Item>
          
          <div className="text-center">
            <Space>
              <Button type="link" onClick={() => navigate('/register')}>
                注册新账号
              </Button>
            </Space>
          </div>
        </Form>
      </Card>
    </div>
  );
}

export default Login;