// src/components/ChangePassword.jsx
import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, Alert, Space, Modal } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { changePassword } from '../services/api';

const { Title, Text } = Typography;

function ChangePassword({ visible, onClose }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const { user } = useSelector(state => state.auth);
  
  const handleSubmit = async (values) => {
    // Reset states
    setError(null);
    setSuccess(false);
    
    // Check if passwords match
    if (values.newPassword !== values.confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    
    setLoading(true);
    
    try {
      console.log('Submitting password change for user:', user?.id);
      
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        userId: user?.id
      });
      
      setSuccess(true);
      form.resetFields();
      
      // Close modal after 2 seconds on success
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Password change failed:', error);
      
      // Specific error handling
      if (error.error) {
        setError(error.error);
      } else if (error.message && error.message.includes('404')) {
        setError('修改密码功能暂时不可用，请与管理员联系');
      } else {
        setError(error.message || '密码修改失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  };
  
  // If no user is available, show an error
  if (!user || !user.id) {
    return (
      <Modal
        title="修改密码"
        open={visible}
        onCancel={onClose}
        footer={[
          <Button key="close" onClick={onClose}>
            关闭
          </Button>
        ]}
      >
        <Alert
          message="用户信息不可用"
          description="无法获取用户信息，请尝试重新登录"
          type="error"
          showIcon
        />
      </Modal>
    );
  }
  
  return (
    <Modal
      title="修改密码"
      open={visible}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      {error && (
        <Alert
          message="错误"
          description={error}
          type="error"
          showIcon
          className="mb-4"
          closable
          onClose={() => setError(null)}
        />
      )}
      
      {success && (
        <Alert
          message="成功"
          description="密码已成功修改！"
          type="success"
          showIcon
          className="mb-4"
        />
      )}
      
      <Form
        form={form}
        name="changePassword"
        onFinish={handleSubmit}
        layout="vertical"
        preserve={false}
      >
        <Form.Item
          name="currentPassword"
          label="当前密码"
          rules={[
            { required: true, message: '请输入当前密码' }
          ]}
        >
          <Input.Password
            prefix={<LockOutlined className="site-form-item-icon" />}
            placeholder="当前密码"
          />
        </Form.Item>
        
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '密码长度至少为6个字符' }
          ]}
        >
          <Input.Password
            prefix={<LockOutlined className="site-form-item-icon" />}
            placeholder="新密码"
          />
        </Form.Item>
        
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          rules={[
            { required: true, message: '请确认新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<LockOutlined className="site-form-item-icon" />}
            placeholder="确认新密码"
          />
        </Form.Item>
        
        <Form.Item className="mb-0">
          <div className="flex justify-end">
            <Space>
              <Button onClick={onClose}>
                取消
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
              >
                修改密码
              </Button>
            </Space>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default ChangePassword;