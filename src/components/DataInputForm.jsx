// src/components/DataInputForm.jsx - 修复数据库导入功能
import React, { useState, useRef } from 'react';
import { Form, Input, Button, message, Card, Alert, Typography, DatePicker, Modal, Space, Divider, Dropdown, Spin } from 'antd';
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
import { submitRawData, exportAllData, importDatabaseDump } from '../services/api';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Title, Text } = Typography;

function DataInputForm({ onSuccess }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false); // For raw data submission
  const [exportLoading, setExportLoading] = useState(false); // For JSON export
  const [formValues, setFormValues] = useState({});
  const [debugInfo, setDebugInfo] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);
  const [jsonPreview, setJsonPreview] = useState(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const fileInputRef = useRef(null);
  
  // States for batch database import
  const [isBatchImportConfirmVisible, setIsBatchImportConfirmVisible] = useState(false);
  const [jsonDataForBatchImport, setJsonDataForBatchImport] = useState(null);
  const [batchImportLoading, setBatchImportLoading] = useState(false);
  const [importProgress, setImportProgress] = useState(''); // 增加进度信息状态

  const formatDateForDisplay = (date) => {
    if (!date) return '';
    return `${date.month() + 1}.${date.date()}`;
  };

  const preprocessData = (rawData) => {
    if (!rawData) return '';
    if (selectedDate) {
      const dateStr = formatDateForDisplay(selectedDate);
      const lines = rawData.trim().split('\n');
      const firstLine = lines[0];
      if (firstLine.match(/^\s*\d{1,2}\.\d{1,2}\s*$/)) {
        lines[0] = dateStr;
        return lines.join('\n');
      } else {
        return `${dateStr}\n${rawData}`;
      }
    }
    return rawData;
  };

  const handleSubmit = async (values) => {
    setFormValues(values);
    setDebugInfo('表单验证通过，开始预处理数据...');
    setLoading(true);
    try {
      const processedData = preprocessData(values.rawData);
      setDebugInfo('数据预处理完成，准备提交...');
      console.log('提交数据 (单个表单):', processedData);
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

  const handleDirectSubmit = async () => {
    const rawData = form.getFieldValue('rawData');
    if (!rawData) {
      message.error('请输入数据');
      return;
    }
    setDebugInfo('尝试直接提交...');
    setLoading(true);
    try {
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

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    let rawData = form.getFieldValue('rawData') || '';
    const processedData = preprocessData(rawData); // Preprocess with the new date
    form.setFieldsValue({ rawData: processedData });
  };

  const handleExportFormJSON = () => {
    const rawData = form.getFieldValue('rawData');
    if (!rawData) {
      message.error('请先输入数据');
      return;
    }
    setDebugInfo('开始准备导出表单数据...');
    const exportData = {
      rawInput: rawData,
      date: selectedDate ? selectedDate.format('YYYY-MM-DD') : null,
      timestamp: new Date().toISOString(),
      format: 'text/plain'
    };
    try {
        downloadJSON(exportData, 'form-data');
        message.success('表单数据已导出');
        setDebugInfo('表单数据准备完成，开始下载...');
    } catch(error){
        console.error('导出表单错误:', error);
        setDebugInfo('导出表单失败: ' + (error.message || '未知错误'));
        message.error('导出表单失败: ' + (error.message || '未知错误'));
    }
  };
  
  const handleExportAllData = async () => {
    setExportLoading(true);
    setDebugInfo('开始导出所有数据库数据...');
    message.loading('正在获取数据库数据，请稍候...', 0);
    try {
      const allData = await exportAllData();
      message.destroy();
      setDebugInfo('数据库数据获取成功，准备下载...');
      downloadJSON(allData, 'all-database-data');
      message.success('已导出所有数据库数据');
    } catch (error) {
      message.destroy();
      console.error('导出所有数据错误:', error);
      setDebugInfo('导出数据库数据失败: ' + (error.message || '未知错误'));
      message.error('导出数据库数据失败: ' + (error.message || '未知错误'));
    } finally {
      setExportLoading(false);
    }
  };
  
  const downloadJSON = (data, fileNamePrefix) => {
    try {
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const date = new Date();
        const fileName = `${fileNamePrefix}-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.json`;
        if (navigator.msSaveBlob) { 
          navigator.msSaveBlob(blob, fileName);
        } else {
          const downloadLink = document.createElement('a');
          const url = URL.createObjectURL(blob);
          downloadLink.href = url;
          downloadLink.download = fileName;
          downloadLink.style.display = 'none';
          document.body.appendChild(downloadLink);
          downloadLink.click();
          setTimeout(() => {
            document.body.removeChild(downloadLink);
            window.URL.revokeObjectURL(url);
          }, 100);
        }
        setDebugInfo('下载完成: ' + fileName);
      } catch (error) {
        console.error('下载JSON错误:', error);
        throw error; 
      }
  };
  
  const handleFileInputChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    // 检查文件大小
    if (file.size > 10 * 1024 * 1024) { // 10MB限制
      message.error('文件太大，请选择10MB以下的文件');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    setDebugInfo(`开始读取文件: ${file.name}, 大小: ${(file.size / 1024).toFixed(2)}KB`);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        let jsonData;
        
        try {
          jsonData = JSON.parse(content);
          setDebugInfo(`文件 ${file.name} 成功解析为JSON对象`);
        } catch (parseError) {
          setDebugInfo(`JSON解析失败: ${parseError.message}`);
          message.error('JSON格式无效，请确保文件内容是有效的JSON格式');
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
        
        // 识别JSON类型
        if (jsonData.metadata && jsonData.coins && jsonData.metrics && jsonData.liquidity && jsonData.latestData) {
          setDebugInfo('识别为数据库备份JSON，打开预览模态框');
          setJsonPreview({
            type: 'database',
            data: jsonData,
            timestamp: jsonData.metadata.exportDate,
            coinCount: Array.isArray(jsonData.coins) ? jsonData.coins.length : 0,
            metricCount: Array.isArray(jsonData.metrics) ? jsonData.metrics.length : 0
          });
          setJsonDataForBatchImport(jsonData);
          setPreviewVisible(true);
        } else if (jsonData.rawInput) {
          setDebugInfo('识别为表单数据JSON，打开预览模态框');
          setJsonPreview({
            type: 'form',
            data: jsonData,
            timestamp: jsonData.timestamp,
            date: jsonData.date,
            format: jsonData.format || 'text/plain'
          });
          setJsonDataForBatchImport(null);
          setPreviewVisible(true);
        } else {
          setDebugInfo('未能识别JSON格式，尝试作为原始文本添加到表单');
          form.setFieldsValue({ rawData: content });
          message.warning('未识别的JSON格式，已作为原始文本导入');
          setJsonDataForBatchImport(null);
        }
      } catch (error) {
        setDebugInfo(`无法处理文件: ${error.message}`);
        message.error('无法解析JSON文件: ' + (error.message || '未知错误'));
      }
      
      // 清空文件输入框，以便再次选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    
    reader.onerror = (error) => {
      setDebugInfo(`文件读取错误: ${error}`);
      message.error('文件读取失败');
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    
    reader.readAsText(file);
  };

  const handleImportSampleToForm = () => {
    if (!jsonPreview || jsonPreview.type !== 'database' || !jsonPreview.data.latestData) {
      message.warn("无法从该文件导入示例数据到表单。");
      setPreviewVisible(false);
      return;
    }
    
    let sampleText = '';
    try {
      const latestData = jsonPreview.data.latestData;
      if (latestData && latestData.date) {
        sampleText += latestData.date.split('T')[0] + '\n'; // Ensure only date part
        const coins = latestData.coins || [];
        const mainCoins = ['BTC', 'ETH', 'SOL', 'BNB'].filter(
          symbol => coins.some(coin => coin.symbol === symbol)
        );
        for (const coinSymbol of mainCoins) {
          const coin = coins.find(c => c.symbol === coinSymbol);
          if (coin) {
            sampleText += `${coin.symbol} 场外指数${coin.otcIndex || 0}`;
            if (coin.entryExitType === 'entry') {
              sampleText += `场外进场期第${coin.entryExitDay || 0}天`;
            } else if (coin.entryExitType === 'exit') {
              sampleText += `场外退场期第${coin.entryExitDay || 0}天`;
            }
            sampleText += `\n爆破指数${coin.explosionIndex || 0}\n谢林点 ${coin.schellingPoint || 0}\n\n`;
          }
        }
        form.setFieldsValue({ rawData: sampleText.trim() }); // Trim trailing newlines
        if (latestData.date) {
            try {
                setSelectedDate(dayjs(latestData.date.split('T')[0])); // Use dayjs for datepicker
            } catch (e) {
                console.error('无法解析日期用于Datepicker:', e, latestData.date);
            }
        }
      }
    } catch (error) {
      console.error('从数据库数据生成示例失败:', error);
      message.warning('无法从数据库导入示例，请手动输入数据');
    }
    message.success('已从数据库数据导入最新示例到表单。');
    setPreviewVisible(false);
    setJsonDataForBatchImport(null);
  };

  const handleConfirmAndExecuteBatchImport = async () => {
    if (!jsonDataForBatchImport) {
      message.error('没有可供批量导入的数据库数据。');
      setIsBatchImportConfirmVisible(false);
      return;
    }
    
    setBatchImportLoading(true);
    setImportProgress('准备导入...');
    setDebugInfo('开始批量导入数据库...');
    
    try {
      setImportProgress('正在导入币种数据...');
      const result = await importDatabaseDump(jsonDataForBatchImport);
      
      // 成功处理导入结果
      const summary = result.summary || {};
      setDebugInfo(`批量导入完成: 币种: ${summary.coinsImported || 0}, 指标: ${summary.metricsImported || 0}, 流动性记录: ${summary.liquidityImported || 0}, 热门币种: ${summary.trendingImported || 0}`);
      
      message.success(
        `数据库批量导入成功！导入了 ${summary.coinsImported || 0} 个币种, ${summary.metricsImported || 0} 条指标记录。请刷新仪表盘查看最新数据。`, 
        5
      );
      
      // 调用成功回调，通知父组件
      if (onSuccess) onSuccess();
      
    } catch (error) {
      // 增强错误处理和提示
      const errorMsg = error.details || error.error || '批量导入失败';
      setDebugInfo('批量导入失败: ' + errorMsg);
      
      Modal.error({
        title: '数据库导入失败',
        content: (
          <div>
            <p>{errorMsg}</p>
            <p>请检查以下可能的问题:</p>
            <ul>
              <li>确保服务器已启动并运行</li>
              <li>检查网络连接状态</li>
              <li>文件格式可能与服务器期望的不匹配</li>
              <li>数据量可能太大，导致处理超时</li>
            </ul>
            <p>可以尝试重新上传或使用较小的数据集。</p>
          </div>
        ),
        okText: '我明白了'
      });
    } finally {
      setBatchImportLoading(false);
      setIsBatchImportConfirmVisible(false);
      setJsonDataForBatchImport(null);
      setImportProgress('');
    }
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };
  
  const exportMenu = {
    items: [
      { key: '1', label: '导出当前表单数据', icon: <FormOutlined />, onClick: handleExportFormJSON },
      { key: '2', label: '导出所有数据库数据', icon: <DatabaseOutlined />, onClick: handleExportAllData }
    ]
  };

  return (
    <Card title="数据输入与管理" style={{ width: '100%' }}>
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        accept=".json" 
        onChange={handleFileInputChange} 
      />
      
      <div className="mb-4 flex flex-wrap justify-between items-center">
        <Title level={4} style={{marginBottom: 0}}>数据操作</Title>
        <Space>
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
        </Space>
      </div>
      <Divider />
      
      <div className="mb-6">
        <Title level={5}><CalendarOutlined className="mr-2" />选择数据日期</Title>
        <div className="flex items-center">
          <DatePicker 
            placeholder="选择日期 (可选, 将覆盖文本中的日期)" 
            onChange={handleDateSelect} 
            value={selectedDate} 
            format="YYYY-MM-DD" 
            className="mr-3"
          />
          {selectedDate && (
            <Alert 
              message={
                <div>
                  已选日期: <Text strong>{formatDateForDisplay(selectedDate)}</Text>
                  <Text type="secondary" className="ml-2">(月.日格式)</Text>
                </div>
              } 
              type="success" 
              showIcon
            />
          )}
        </div>
        <Text type="secondary" className="mt-1 block">
          <InfoCircleOutlined className="mr-1" />
          选择日期后，提交时将以此日期为准，并自动处理成 "月.日" 格式用于AI解析（如果文本中第一行是日期，则会被替换）。
        </Text>
      </div>
      
      <Form form={form} onFinish={handleSubmit} layout="vertical">
        <Form.Item 
          name="rawData" 
          label="原始数据粘贴区" 
          rules={[{ required: true, message: '请输入原始数据' }]}
        >
          <TextArea 
            rows={10} 
            placeholder="示例格式:
5.9
Btc 场外指数1627场外进场期第26天
爆破指数195
谢林点 98500..." 
            style={{ marginBottom: '10px' }}
          />
        </Form.Item>
        <Space direction="vertical" style={{width: '100%'}}>
            <Button  
              htmlType="submit" 
              loading={loading} 
              size="large" 
              block 
              icon={<CheckCircleOutlined />}
            >
              处理并提交数据 (AI解析)
            </Button>
            <Button 
              onClick={handleDirectSubmit} 
              loading={loading} 
              size="large" 
              block 
              type="dashed"
            >
              备用处理按钮 (跳过表单验证)
            </Button>
        </Space>
      </Form>
      
      <Divider />
      
      <div className="mb-4">
        <Title level={5}>功能说明</Title>
        <Space direction="vertical" className="w-full">
          <Alert
            message="JSON导入导出功能"
            description={
              <div>
                <p>1. <Text strong>导出表单数据</Text>: 将当前表单输入的内容保存为JSON文件。</p>
                <p>2. <Text strong>导出数据库数据</Text>: 导出系统中所有币种、指标和流动性数据为JSON备份文件。</p>
                <div> 
                  <Text strong>3. 导入JSON:</Text>
                  <ul>
                    <li>若导入的是<Text code>表单数据JSON</Text>，可填充到上方输入框。</li>
                    <li>若导入的是<Text code>数据库备份JSON</Text>，可选择批量导入整个文件到数据库，或仅提取最新示例填充到表单。</li>
                  </ul>
                </div>
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
                <p>1. 系统接受"月.日"格式的日期，例如 "5.9" 表示5月9日。</p>
                <p>2. 如果在上方选择了日期，该日期将优先使用，并会覆盖文本中第一行的日期（如果存在）。</p>
                <p>3. 如果未选择日期且文本中第一行不是 "月.日" 格式，提交时AI会尝试解析或使用当前日期。</p>
                <p>4. 建议使用日期选择器以确保日期准确性。</p>
              </div> 
            }
            type="info" 
            showIcon 
            icon={<InfoCircleOutlined />}
          />
        </Space>
      </div>
      
      {debugInfo && (
        <Alert 
          message="调试信息" 
          description={debugInfo} 
          type="info" 
          style={{ marginTop: '20px' }} 
          showIcon 
          closable 
        />
      )}
      
      <Modal
        title="JSON数据预览与操作"
        open={previewVisible}
        onCancel={() => { 
          setPreviewVisible(false); 
          setJsonDataForBatchImport(null); 
        }}
        footer={null} 
        width={700}
        destroyOnClose // 确保每次打开都是新的内容
      >
        {jsonPreview && jsonPreview.type === 'form' && (
          <div>
            <Title level={5}>表单数据预览</Title>
            <div className="bg-gray-100 p-3 rounded mt-1 mb-3">
              <p><Text type="secondary">时间戳:</Text> {jsonPreview.timestamp || '未知'}</p>
              {jsonPreview.date && <p><Text type="secondary">记录日期:</Text> {jsonPreview.date} <CheckCircleOutlined className="text-green-500 ml-1" /></p>}
              <p><Text type="secondary">格式:</Text> {jsonPreview.format || '未知'}</p>
            </div>
            <Text strong>原始数据:</Text>
            <div className="bg-gray-100 p-2 rounded mt-1 max-h-60 overflow-y-auto mb-4">
              <pre className="whitespace-pre-wrap">{jsonPreview.data.rawInput}</pre>
            </div>
            <Button 
              onClick={() => {
                if (jsonPreview.data.rawInput) form.setFieldsValue({ rawData: jsonPreview.data.rawInput });
                if (jsonPreview.data.date) { 
                  try { 
                    setSelectedDate(dayjs(jsonPreview.data.date)); 
                  } catch(e){ 
                    console.error(e);
                  }
                }
                message.success('表单数据已填充到输入框。');
                setPreviewVisible(false);
              }} 
              type="primary" 
              block
            >
              确认填充到表单
            </Button>
          </div>
        )}
        
        {jsonPreview && jsonPreview.type === 'database' && (
          <div>
            <Title level={5}>数据库备份文件预览</Title>
            <div className="bg-gray-100 p-3 rounded mt-1 mb-3">
              <p><Text type="secondary">文件导出时间:</Text> {jsonPreview.timestamp || '未知'}</p>
              <p><Text type="secondary">包含币种数:</Text> {jsonPreview.coinCount}</p>
              <p><Text type="secondary">包含指标记录数:</Text> {jsonPreview.metricCount}</p>
              {jsonPreview.data.metadata?.availableDates && (
                <p><Text type="secondary">日期范围:</Text> {jsonPreview.data.metadata.availableDates.join(', ')}</p>
              )}
              {jsonPreview.data.metadata?.dataLatest && (
                <p><Text type="secondary">最新日期:</Text> {jsonPreview.data.metadata.dataLatest}</p>
              )}
            </div>
            <Alert 
              message="请选择操作" 
              description="您可以批量导入整个文件，或仅提取最新示例填充到表单。" 
              type="info" 
              showIcon 
              className="mb-4"
            />
            <Space direction="vertical" style={{width: '100%'}}>
              <Button onClick={handleImportSampleToForm} block>仅提取最新示例到表单</Button>
              <Button 
                type="primary" 
                danger 
                block 
                onClick={() => { 
                  setPreviewVisible(false); 
                  setIsBatchImportConfirmVisible(true); 
                }}
              >
                批量导入整个文件到数据库
              </Button>
            </Space>
          </div>
        )}

        {jsonPreview && jsonPreview.type !== 'form' && jsonPreview.type !== 'database' && (
             <Button onClick={() => { setPreviewVisible(false); }} block style={{marginTop: '16px'}}>关闭预览</Button>
        )}
      </Modal>

      <Modal
        title="确认批量导入数据库"
        open={isBatchImportConfirmVisible}
        onOk={handleConfirmAndExecuteBatchImport}
        onCancel={() => setIsBatchImportConfirmVisible(false)}
        okText="确认执行批量导入"
        cancelText="取消"
        confirmLoading={batchImportLoading}
        okButtonProps={{ danger: true }}
        zIndex={1050}
      >
        {batchImportLoading ? (
          <div className="text-center py-4">
            <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
            <p className="mt-3">{importProgress || '正在导入数据...'}</p>
            <p className="text-gray-500">请勿关闭窗口，此过程可能需要几分钟</p>
          </div>
        ) : (
          <Alert
            message="重要提示" 
            description={<>
                <p>此操作将会尝试将JSON文件中的所有币种、历史指标、流动性数据等写入到您当前的数据库中。</p>
                <p>对于已存在的数据（例如：同一币种同一天的指标），系统将尝试更新。</p>
                <p>根据数据量大小，此过程可能需要几分钟时间。请耐心等待，期间请勿关闭页面。</p>
                <p><strong>强烈建议在执行此操作前备份您当前的数据库！</strong></p>
                <p>您确定要继续吗？</p>
            </>}
            type="warning"
            showIcon
            className="mb-4"
          />
        )}
      </Modal>
    </Card>
  );
}

export default DataInputForm;