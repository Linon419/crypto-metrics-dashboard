// src/components/DataInputForm.jsx - 增加数据库导出功能
import React, { useState, useRef } from 'react';
import { Form, Input, Button, message, Card, Alert, Typography, DatePicker, Modal, Space, Divider, Dropdown } from 'antd';
import { 
  CalendarOutlined, 
  InfoCircleOutlined, 
  UploadOutlined, 
  DownloadOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  FormOutlined,
  LoadingOutlined,
  CaretDownOutlined
} from '@ant-design/icons';
import { submitRawData, exportAllData } from '../services/api';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Title, Text, Paragraph } = Typography;

function DataInputForm({ onSuccess }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [debugInfo, setDebugInfo] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);
  const [jsonPreview, setJsonPreview] = useState(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const fileInputRef = useRef(null);

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

  // 导出当前表单数据为JSON
  const handleExportFormJSON = () => {
    try {
      // 获取当前表单数据
      const rawData = form.getFieldValue('rawData');
      if (!rawData) {
        message.error('请先输入数据');
        return;
      }
      
      // 添加调试信息
      setDebugInfo('开始准备导出表单数据...');
      
      // 创建导出数据结构
      const exportData = {
        rawInput: rawData,
        date: selectedDate ? selectedDate.format('YYYY-MM-DD') : null,
        timestamp: new Date().toISOString(),
        format: 'text/plain'
      };
      
      setDebugInfo('表单数据准备完成，开始下载...');
      
      // 下载文件
      downloadJSON(exportData, 'form-data');
      message.success('表单数据已导出');
    } catch (error) {
      console.error('导出表单错误:', error);
      setDebugInfo('导出表单失败: ' + (error.message || '未知错误'));
      message.error('导出表单失败: ' + (error.message || '未知错误'));
    }
  };
  
  // 导出所有数据库数据为JSON
  const handleExportAllData = async () => {
    try {
      setExportLoading(true);
      setDebugInfo('开始导出所有数据库数据...');
      
      // 显示开始导出消息
      message.loading('正在获取数据库数据，请稍候...', 0);
      
      // 调用API获取所有数据
      const allData = await exportAllData();
      
      // 关闭加载消息
      message.destroy();
      
      setDebugInfo('数据库数据获取成功，准备下载...');
      
      // 下载文件
      downloadJSON(allData, 'all-database-data');
      
      message.success('已导出所有数据库数据');
    } catch (error) {
      console.error('导出所有数据错误:', error);
      setDebugInfo('导出数据库数据失败: ' + (error.message || '未知错误'));
      message.error('导出数据库数据失败: ' + (error.message || '未知错误'));
    } finally {
      setExportLoading(false);
      message.destroy(); // 确保关闭所有消息
    }
  };
  
  // 通用JSON下载函数
  const downloadJSON = (data, fileNamePrefix) => {
    try {
      // 创建Blob对象
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      
      // 生成文件名
      const date = new Date();
      const fileName = `${fileNamePrefix}-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.json`;
      
      // 使用更可靠的下载方法
      if (navigator.msSaveBlob) { // IE 10+
        navigator.msSaveBlob(blob, fileName);
        setDebugInfo('下载完成: ' + fileName);
        return;
      }
      
      // 其他现代浏览器
      const downloadLink = document.createElement('a');
      
      // 创建下载链接
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = fileName;
      
      // 确保链接不可见
      downloadLink.style.display = 'none';
      document.body.appendChild(downloadLink);
      
      // 触发点击
      downloadLink.click();
      
      // 清理
      setTimeout(() => {
        document.body.removeChild(downloadLink);
        window.URL.revokeObjectURL(url);
        setDebugInfo('下载完成: ' + fileName);
      }, 100);
    } catch (error) {
      console.error('下载JSON错误:', error);
      throw error;
    }
  };
  
  // 处理文件选择变更
  const handleFileInputChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        let jsonData;
        
        try {
          jsonData = JSON.parse(content);
        } catch (parseError) {
          message.error('JSON格式无效，请确保文件内容是有效的JSON格式');
          return;
        }
        
        // 判断数据类型 - 表单数据还是数据库数据
        if (jsonData.rawInput) {
          // 表单数据
          setJsonPreview({
            type: 'form',
            data: jsonData,
            timestamp: jsonData.timestamp,
            date: jsonData.date,
            format: jsonData.format || 'text/plain'
          });
          setPreviewVisible(true);
        } else if (jsonData.metadata) {
          // 数据库数据
          setJsonPreview({
            type: 'database',
            data: jsonData,
            timestamp: jsonData.metadata.exportDate,
            coinCount: Array.isArray(jsonData.coins) ? jsonData.coins.length : 0,
            metricCount: Array.isArray(jsonData.metrics) ? jsonData.metrics.length : 0
          });
          setPreviewVisible(true);
        } else {
          // 未知格式，尝试作为原始文本导入
          form.setFieldsValue({ rawData: content });
          message.warning('未识别的JSON格式，已作为原始文本导入');
        }
      } catch (error) {
        message.error('无法解析JSON文件: ' + (error.message || '未知错误'));
      }
    };
    
    reader.readAsText(file);
    // 重置input，允许选择同一个文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 确认导入预览的数据
  const handleConfirmImport = () => {
    if (!jsonPreview) return;
    
    if (jsonPreview.type === 'form' && jsonPreview.data.rawInput) {
      // 导入表单数据
      form.setFieldsValue({ rawData: jsonPreview.data.rawInput });
      
      // 如果JSON中包含日期信息
      if (jsonPreview.data.date) {
        try {
          const date = dayjs(jsonPreview.data.date);
          setSelectedDate(date);
        } catch (e) {
          console.error('无法解析日期', e);
        }
      }
      
      message.success('表单数据已导入');
    } else if (jsonPreview.type === 'database') {
      // 导入数据库数据 - 将最近的一条币种数据作为示例
      let sampleText = '';
      
      try {
        const latestData = jsonPreview.data.latestData;
        if (latestData && latestData.date) {
          sampleText += latestData.date + '\n';
          
          // 添加几个主要币种的最新数据
          const coins = latestData.coins || [];
          const mainCoins = ['BTC', 'ETH', 'SOL', 'BNB'].filter(
            symbol => coins.some(coin => coin.symbol === symbol)
          );
          
          for (const coinSymbol of mainCoins) {
            const coin = coins.find(c => c.symbol === coinSymbol);
            if (coin) {
              sampleText += `${coin.symbol} 场外指数${coin.otcIndex}`;
              if (coin.entryExitType === 'entry') {
                sampleText += `场外进场期第${coin.entryExitDay}天`;
              } else if (coin.entryExitType === 'exit') {
                sampleText += `场外退场期第${coin.entryExitDay}天`;
              }
              sampleText += `\n爆破指数${coin.explosionIndex}\n谢林点 ${coin.schellingPoint}\n\n`;
            }
          }
          
          form.setFieldsValue({ rawData: sampleText });
          
          // 设置日期
          try {
            const date = dayjs(latestData.date);
            setSelectedDate(date);
          } catch (e) {
            console.error('无法解析日期', e);
          }
        }
      } catch (error) {
        console.error('从数据库数据生成示例失败:', error);
        message.warning('无法从数据库导入示例，请手动输入数据');
      }
      
      message.success('已从数据库数据导入最新示例');
    }
    
    setPreviewVisible(false);
    setJsonPreview(null);
  };

  // 触发文件选择器点击
  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };
  
  // 导出选项菜单
  const exportMenu = {
    items: [
      {
        key: '1',
        label: '导出当前表单数据',
        icon: <FormOutlined />,
        onClick: handleExportFormJSON
      },
      {
        key: '2',
        label: '导出所有数据库数据',
        icon: <DatabaseOutlined />,
        onClick: handleExportAllData
      }
    ]
  };

  return (
    <Card title="数据输入" style={{ width: '100%' }}>
      {/* 隐藏的文件输入框 */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".json"
        onChange={handleFileInputChange}
      />
      
      {/* 数据导入/导出按钮组 */}
      <div className="mb-4 flex justify-end space-x-2">
        <Button 
          icon={<UploadOutlined />} 
          onClick={handleImportClick}
          style={{ borderColor: '#1890ff', color: '#1890ff' }}
        >
          导入JSON
        </Button>
        
        <Dropdown menu={exportMenu} placement="bottomRight">
          <Button 
            style={{ borderColor: '#52c41a', color: '#52c41a' }}
            loading={exportLoading}
          >
            <Space>
              <DownloadOutlined />
              导出数据
              <CaretDownOutlined />
            </Space>
          </Button>
        </Dropdown>
      </div>
      
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
      
      <Divider />
      
      {/* 功能说明 */}
      <div className="mb-4">
        <Title level={5}>功能说明</Title>
        <Space direction="vertical" className="w-full">
          <Alert
            message="JSON导入导出功能"
            description={
              <div>
                <p>1. <Text strong>导出表单数据</Text>: 将当前表单输入的内容保存为JSON文件</p>
                <p>2. <Text strong>导出数据库数据</Text>: 导出系统中所有币种、指标和流动性数据</p>
                <p>3. <Text strong>导入JSON</Text>: 从之前导出的任意JSON文件中恢复数据</p>
              </div>
            }
            type="info"
            showIcon
            icon={<FileTextOutlined />}
          />
          
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
          />
        </Space>
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
      
      {/* JSON预览对话框 */}
      <Modal
        title="JSON数据预览"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        onOk={handleConfirmImport}
        okText="确认导入"
        cancelText="取消"
        width={700}
      >
        {jsonPreview && jsonPreview.type === 'form' && (
          <div>
            <div className="mb-4">
              <Text strong>表单数据信息:</Text>
              <div className="bg-gray-100 p-2 rounded mt-1">
                <p><Text type="secondary">时间戳:</Text> {jsonPreview.timestamp || '未知'}</p>
                {jsonPreview.date && <p><Text type="secondary">日期:</Text> {jsonPreview.date} <CheckCircleOutlined className="text-green-500 ml-1" /></p>}
                <p><Text type="secondary">格式:</Text> {jsonPreview.format || '未知'}</p>
              </div>
            </div>
            
            <div>
              <Text strong>原始数据:</Text>
              <div className="bg-gray-100 p-2 rounded mt-1 max-h-80 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{jsonPreview.data.rawInput}</pre>
              </div>
            </div>
          </div>
        )}
        
        {jsonPreview && jsonPreview.type === 'database' && (
          <div>
            <div className="mb-4">
              <Text strong>数据库导出信息:</Text>
              <div className="bg-gray-100 p-2 rounded mt-1">
                <p><Text type="secondary">导出时间:</Text> {jsonPreview.timestamp || '未知'}</p>
                <p><Text type="secondary">币种数量:</Text> {jsonPreview.coinCount}</p>
                <p><Text type="secondary">指标记录数量:</Text> {jsonPreview.metricCount}</p>
              </div>
            </div>
            
            <Alert
              message="数据库数据导入说明"
              description="将从数据库提取最新的币种数据作为表单示例。您可以根据需要进行修改。"
              type="info"
              showIcon
            />
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default DataInputForm;