// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { Provider } from 'react-redux';
import { store } from './redux/store';
import DataInputForm from './components/DataInputForm';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import Register from './components/Register';
import ProtectedRoute from './components/ProtectedRoute';
import { useSelector } from 'react-redux';

const { Header, Content, Footer } = Layout;

// 导航组件，只在用户已登录时显示
const NavigationMenu = () => {
  const { isAuthenticated } = useSelector(state => state.auth);
  
  // 如果用户未登录，不显示导航栏
  if (!isAuthenticated) {
    return null;
  }
  
  return (
    <Header>
      <Menu theme="dark" mode="horizontal" defaultSelectedKeys={['1']}>
        <Menu.Item key="1">
          <Link to="/">首页</Link>
        </Menu.Item>
        <Menu.Item key="2">
          <Link to="/input">数据输入</Link>
        </Menu.Item>
        <Menu.Item key="3">
          <Link to="/dashboard">数据看板</Link>
        </Menu.Item>
      </Menu>
    </Header>
  );
};

// 包装App组件，使其可访问Redux状态
const AppWithRedux = () => {
  return (
    <Provider store={store}>
      <AppContent />
    </Provider>
  );
};

// 主App内容组件
const AppContent = () => {
  return (
    <Router>
      <Layout className="min-h-screen">
        <NavigationMenu />
        
        <Content className="p-6">
          <Routes>
            {/* Public routes - accessible without authentication */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            
            {/* Protected routes - require authentication */}
            <Route path="/" element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } />
            
            <Route path="/input" element={
              <ProtectedRoute>
                <DataInputForm />
              </ProtectedRoute>
            } />
            
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } />
            
            {/* Redirect unknown routes to dashboard */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Content>
        
        <Footer className="text-center">加密货币指标看板 ©2025</Footer>
      </Layout>
    </Router>
  );
};

export default AppWithRedux;