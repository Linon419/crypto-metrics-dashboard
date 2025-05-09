import React, { useState } from 'react';
import { Form, Input, Button, message, Card, Alert } from 'antd';
import { submitRawData } from '../services/api';

const { TextArea } = Input;

function DataInputForm({ onSuccess }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [debugInfo, setDebugInfo] = useState('');

  const handleSubmit = async (values) => {
    try {
      setFormValues(values);
      setDebugInfo('表单验证通过，开始提交...');
      setLoading(true);
      
      // 直接在组件中记录
      console.log('提交数据:', values.rawData);
      
      const result = await submitRawData(values.rawData);
      setDebugInfo('提交成功，结果: ' + JSON.stringify(result).substring(0, 100) + '...');
      message.success('数据处理成功!');
      form.resetFields();
      
      if (onSuccess) onSuccess();
    } catch (error) {
      setDebugInfo('提交失败: ' + (error.message || '未知错误'));
      message.error('数据处理失败: ' + (error.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  // 直接提交的备用函数
  const handleDirectSubmit = async () => {
    const rawData = form.getFieldValue('rawData');
    if (!rawData) {
      message.error('请输入数据');
      return;
    }
    
    setDebugInfo('尝试直接提交...');
    try {
      setLoading(true);
      const result = await submitRawData(rawData);
      setDebugInfo('直接提交成功，结果: ' + JSON.stringify(result).substring(0, 100) + '...');
      message.success('数据处理成功!');
      if (onSuccess) onSuccess();
    } catch (error) {
      setDebugInfo('直接提交失败: ' + (error.message || '未知错误'));
      message.error('直接提交失败: ' + (error.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="数据输入" style={{ width: '100%' }}>
      <Form form={form} onFinish={handleSubmit} layout="vertical">
        <Form.Item
          name="rawData"
          label="输入原始数据"
          rules={[{ required: true, message: '请输入数据' }]}
        >
          <TextArea 
            rows={10} 
            placeholder="例如: 5.8&#10;Btc 场外指数1627场外进场期第26天&#10;爆破指数195&#10;谢林点 98500..."
            style={{ marginBottom: '20px' }}
          />
        </Form.Item>
        
        {/* 主处理按钮 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px', marginBottom: '20px' }}>
          <Button 
            type="primary" 
            htmlType="submit" 
            loading={loading}
            size="large"
            style={{ 
              height: '50px', 
              fontSize: '18px', 
              width: '80%',
              background: '#1890ff',
              borderColor: '#1890ff',
              boxShadow: '0 4px 12px rgba(24, 144, 255, 0.5)'
            }}
          >
            处理数据 (表单提交)
          </Button>
        </div>
      </Form>
      
      {/* 备用直接提交按钮，不通过表单验证 */}
      <div style={{ marginTop: '10px', textAlign: 'center' }}>
        <Button 
          onClick={handleDirectSubmit}
          type="default"
          loading={loading}
          style={{ marginTop: '10px' }}
        >
          备用处理按钮 (直接调用API)
        </Button>
      </div>
      
      {/* 调试信息显示 */}
      {debugInfo && (
        <Alert
          message="调试信息"
          description={debugInfo}
          type="info"
          style={{ marginTop: '20px' }}
        />
      )}
      
      {Object.keys(formValues).length > 0 && (
        <Alert
          message="表单值"
          description={`表单值: ${JSON.stringify(formValues)}`}
          type="info"
          style={{ marginTop: '10px' }}
        />
      )}
    </Card>
  );
}

export default DataInputForm;