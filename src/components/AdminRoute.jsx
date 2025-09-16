// src/components/AdminRoute.jsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Result, Button } from 'antd';
import { LockOutlined } from '@ant-design/icons';

const AdminRoute = ({ children }) => {
  const { isAuthenticated, user } = useSelector(state => state.auth);

  // 如果未认证，重定向到登录页
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // 如果已认证但不是管理员，显示权限不足页面
  if (user?.role !== 'admin') {
    return (
      <Result
        status="403"
        title="403"
        subTitle="抱歉，您没有权限访问此页面。"
        icon={<LockOutlined style={{ color: '#faad14' }} />}
        extra={
          <Button type="primary" onClick={() => window.history.back()}>
            返回
          </Button>
        }
      />
    );
  }

  // 如果是管理员，渲染子组件
  return children;
};

export default AdminRoute;