// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import DataInputForm from './components/DataInputForm';
import Dashboard from './components/Dashboard';

const { Header, Content, Footer } = Layout;

function App() {
  return (
    <Router>
      <Layout className="min-h-screen">
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
        
        <Content className="p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/input" element={<DataInputForm />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </Content>
        
        <Footer className="text-center">加密货币指标看板 ©2024</Footer>
      </Layout>
    </Router>
  );
}

export default App;