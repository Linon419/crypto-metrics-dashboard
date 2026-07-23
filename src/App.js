// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { Provider } from 'react-redux';
import { store } from './redux/store';
import DataInputForm from './components/DataInputForm';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import Register from './components/Register';
import OptionsPage from './components/OptionsPage';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import AdminSettings from './components/AdminSettings';
import { useAutoHideOnScroll } from './hooks/useAutoHideOnScroll';
import { useSelector } from 'react-redux';
import './styles/mobile.css';
import './styles/design-system.css';

const { Header, Content, Footer } = Layout;

// 导航组件，只在用户已登录时显示
const NavigationMenu = () => {
  const { isAuthenticated, user } = useSelector(state => state.auth);
  const location = useLocation();
  const isDashboardRoute = location.pathname === '/' || location.pathname.startsWith('/dashboard');
  const hideGlobalNav = useAutoHideOnScroll(isAuthenticated && isDashboardRoute);
  
  // 如果用户未登录，不显示导航栏
  if (!isAuthenticated) {
    return null;
  }

  const activeKey = location.pathname.startsWith('/input')
    ? '2'
    : location.pathname.startsWith('/admin/settings') || location.pathname.startsWith('/users') || location.pathname.startsWith('/settings/kline-mappings')
    ? '6'
    : location.pathname.startsWith('/options')
    ? '5'
    : location.pathname.startsWith('/dashboard') || location.pathname === '/'
    ? '4'
    : '4';
  
  return (
    <Header className={`global-nav${hideGlobalNav ? ' is-hidden-on-scroll' : ''}`}>
      <Link to="/dashboard" className="global-nav__brand">
        <span className="global-nav__mark">CM</span>
        <span>Crypto Metrics</span>
      </Link>
      <Menu theme="dark" mode="horizontal" selectedKeys={[activeKey]} className="global-nav__menu">
        <Menu.Item key="4">
          <Link to="/dashboard">数据看板</Link>
        </Menu.Item>
        <Menu.Item key="5">
          <Link to="/options">期权</Link>
        </Menu.Item>
        {/* 只有管理员才能看到管理菜单 */}
        {user?.role === 'admin' && (
          <Menu.Item key="2">
            <Link to="/input">数据输入</Link>
          </Menu.Item>
        )}
        {user?.role === 'admin' && (
          <Menu.Item key="6">
            <Link to="/admin/settings">Admin设置</Link>
          </Menu.Item>
        )}
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
        
        <Content className="app-route-content">
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
                <AdminRoute>
                  <DataInputForm />
                </AdminRoute>
              </ProtectedRoute>
            } />
            
            <Route path="/users" element={
              <ProtectedRoute>
                <AdminRoute>
                  <Navigate to="/admin/settings?tab=users" replace />
                </AdminRoute>
              </ProtectedRoute>
            } />

            <Route path="/settings/kline-mappings" element={
              <ProtectedRoute>
                <AdminRoute>
                  <Navigate to="/admin/settings" replace />
                </AdminRoute>
              </ProtectedRoute>
            } />

            <Route path="/admin/settings" element={
              <ProtectedRoute>
                <AdminRoute>
                  <AdminSettings />
                </AdminRoute>
              </ProtectedRoute>
            } />
            
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } />

            <Route path="/options" element={
              <ProtectedRoute>
                <OptionsPage />
              </ProtectedRoute>
            } />
            
            {/* Redirect unknown routes to dashboard */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Content>
        
        <Footer className="app-footer">加密货币指标看板 ©2025</Footer>
      </Layout>
    </Router>
  );
};

export default AppWithRedux;
