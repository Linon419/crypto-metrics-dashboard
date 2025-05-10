// src/components/UserProfile.jsx
import React, { useState } from 'react';
import { Card, Typography, Avatar, Divider, Button, Modal, Form, Input, Alert, Space } from 'antd';
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import ChangePassword from './ChangePassword';

const { Title, Text, Paragraph } = Typography;

function UserProfile({ visible, onClose }) {
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const { user } = useSelector(state => state.auth);
  
  return (
    <Modal
      title="用户信息"
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>
      ]}
      width={500}
    >
      <div className="text-center mb-6">
        <Avatar size={80} icon={<UserOutlined />} className="bg-blue-500" />
        <Title level={3} className="mt-3 mb-0">
          {user?.username || '用户'}
        </Title>
        <Text type="secondary">
          {user?.role === 'admin' ? '管理员' : '普通用户'}
        </Text>
      </div>
      
      <Divider />
      
      <div className="mb-6">
        <div className="flex items-center mb-4">
          <UserOutlined className="mr-2 text-blue-500" />
          <Text strong>用户名：</Text>
          <Text className="ml-2">{user?.username}</Text>
        </div>
        
        {user?.email && (
          <div className="flex items-center mb-4">
            <MailOutlined className="mr-2 text-blue-500" />
            <Text strong>电子邮箱：</Text>
            <Text className="ml-2">{user.email}</Text>
          </div>
        )}
        
        <div className="flex items-center">
          <LockOutlined className="mr-2 text-blue-500" />
          <Text strong>账户安全：</Text>
          <Button 
            type="link" 
            onClick={() => setPasswordModalVisible(true)}
            className="ml-2 p-0"
          >
            修改密码
          </Button>
        </div>
      </div>
      
      <Divider />
      
      <div className="text-center">
        <Text type="secondary">
          上次登录时间: {new Date().toLocaleString()}
        </Text>
      </div>
      
      {/* 密码修改模态框 */}
      <ChangePassword 
        visible={passwordModalVisible}
        onClose={() => setPasswordModalVisible(false)}
      />
    </Modal>
  );
}

export default UserProfile;