// src/components/DataInputForm.jsx - 修复日期解析问题
import React, { useState } from 'react';
import { Form, Input, Button, message, Card, Alert, Typography, DatePicker } from 'antd';
import { CalendarOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { submitRawData } from '../services/api';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Title, Text } = Typography;

function DataInputForm({ onSuccess }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [debugInfo, setDebugInfo] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);

  // 用于显示友好的日期格式
  const formatDateForDisplay = (date) => {
    if (!date) return '';
    return `${date.month() + 1}.${date.date()}`;
  };

  // 将用户输入数据预处理
  const preprocessData = (rawData) => {
    if (!rawData) return '';
    
    // 如果使用了日期选择器，确保日期格式正确
    if (selectedDate) {
      const dateStr = formatDateForDisplay(selectedDate);
      
      // 检查原始数据是否已经包含日期
      const lines = rawData.trim().split('\n');
      const firstLine = lines[0];
      
      // 如果第一行是日期格式（如5.9），则替换它
      if (firstLine.match(/^\s*\d{1,2}\.\d{1,2}\s*$/)) {
        lines[0] = dateStr;
        return lines.join('\n');
      } 
      // 如果没有日期，则添加日期作为第一行
      else {
        return `${dateStr}\n${rawData}`;
      }
    }
    
    return rawData;
  };

  const handleSubmit = async (values) => {
    try {
      setFormValues(values);
      setDebugInfo('表单验证通过，开始预处理数据...');
      setLoading(true);
      
      // 预处理数据，确保日期格式正确
      const processedData = preprocessData(values.rawData);
      setDebugInfo('数据预处理完成，准备提交...');
      
      // 记录提交的数据
      console.log('提交数据:', processedData);
      
      const result = await submitRawData(processedData);
      setDebugInfo('提交成功，结果: ' + JSON.stringify(result).substring(0, 100) + '...');
      message.success('数据处理成功!');
      form.resetFields();
      setSelectedDate(null);
      
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
      // 预处理数据，确保日期格式正确
      const processedData = preprocessData(rawData);
      
      const result = await submitRawData(processedData);
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

  // 处理日期选择
  const handleDateSelect = (date) => {
    setSelectedDate(date);
    // 获取现有数据
    let rawData = form.getFieldValue('rawData') || '';
    
    // 预处理展示给用户
    const processedData = preprocessData(rawData);
    form.setFieldsValue({ rawData: processedData });
  };

  return (
    <Card title="数据输入" style={{ width: '100%' }}>
      {/* 日期选择区域 */}
      <div className="mb-4">
        <Title level={5}>
          <CalendarOutlined className="mr-2" />
          选择日期
        </Title>
        <div className="flex items-center">
          <DatePicker 
            placeholder="选择日期 (可选)" 
            onChange={handleDateSelect}
            value={selectedDate}
            format="YYYY-MM-DD"
            className="mr-3"
          />
          {selectedDate && (
            <Alert 
              message={
                <div>
                  已选择日期: <Text strong>{formatDateForDisplay(selectedDate)}</Text>
                  <Text type="secondary" className="ml-2">
                    (月.日格式)
                  </Text>
                </div>
              }
              type="success" 
              showIcon
            />
          )}
        </div>
        <Text type="secondary" className="mt-1 block">
          <InfoCircleOutlined className="mr-1" />
          选择日期后，系统将自动处理格式，确保正确解析为"月.日"格式
        </Text>
      </div>
      
      <Form form={form} onFinish={handleSubmit} layout="vertical">
        <Form.Item
          name="rawData"
          label="输入原始数据"
          rules={[{ required: true, message: '请输入数据' }]}
        >
          <TextArea 
            rows={10} 
            placeholder="示例格式:&#10;5.9&#10;Btc 场外指数1627场外进场期第26天&#10;爆破指数195&#10;谢林点 98500..."
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
      
      {/* 日期格式说明 */}
      <Alert
        message="日期格式说明"
        description={
          <div>
            <p>1. 系统接受"月.日"格式的日期，如"5.9"表示5月9日</p>
            <p>2. 日期应该放在数据的第一行</p>
            <p>3. 请使用日期选择器来避免格式错误</p>
          </div>
        }
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        style={{ marginTop: '20px' }}
      />
      
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