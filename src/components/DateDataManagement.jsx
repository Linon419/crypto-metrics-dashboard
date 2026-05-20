import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  message,
  Popconfirm,
  Select,
  Space,
  TimePicker,
  Typography,
} from 'antd';
import {
  ClockCircleOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  deleteDateRecordsByDate,
  getDateRecordSummary,
  updateDateRecordTime,
} from '../services/api';

const { Text } = Typography;
const { Option } = Select;

function DateDataManagement() {
  const [selectedDate, setSelectedDate] = useState(null);
  const [timePrecision, setTimePrecision] = useState('minute');
  const [selectedTime, setSelectedTime] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedDateStr = selectedDate ? selectedDate.format('YYYY-MM-DD') : '';
  const totalRecords = summary?.counts?.total || 0;

  const loadSummary = async (date = selectedDateStr) => {
    if (!date) return;

    setLoading(true);
    try {
      const response = await getDateRecordSummary(date);
      setSummary(response.summary || null);
    } catch (error) {
      message.error(`加载日期概况失败: ${error.displayMessage || error.message}`);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (date) => {
    setSelectedDate(date);
    setSummary(null);

    if (date) {
      loadSummary(date.format('YYYY-MM-DD'));
    }
  };

  const handlePrecisionChange = (precision) => {
    setTimePrecision(precision);
    if (precision === 'day') {
      setSelectedTime(null);
    }
  };

  const handleUpdateTime = async () => {
    if (!selectedDateStr) {
      message.error('请选择日期');
      return;
    }

    if (timePrecision !== 'day' && !selectedTime) {
      message.error('请选择具体时间');
      return;
    }

    setSaving(true);
    try {
      const time = timePrecision === 'day'
        ? null
        : selectedTime.format(timePrecision === 'hour' ? 'HH:00' : 'HH:mm');

      const response = await updateDateRecordTime(selectedDateStr, {
        time,
        timePrecision,
      });

      const updatedTotal = response.result?.updated?.total || 0;
      message.success(`已更新 ${updatedTotal} 条日期时间记录`);
      loadSummary(selectedDateStr);
    } catch (error) {
      message.error(`修改日期时间失败: ${error.displayMessage || error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDate = async () => {
    if (!selectedDateStr) return;

    setDeleting(true);
    try {
      const response = await deleteDateRecordsByDate(selectedDateStr);
      const deletedTotal = response.result?.deleted?.total || 0;
      message.success(`已删除 ${selectedDateStr} 的 ${deletedTotal} 条记录`);
      setSummary({
        date: selectedDateStr,
        counts: {
          dailyMetrics: 0,
          liquidityOverviews: 0,
          trendingCoins: 0,
          total: 0,
        },
      });
    } catch (error) {
      message.error(`删除日期数据失败: ${error.displayMessage || error.message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <ClockCircleOutlined />
          <span>日期数据管理</span>
        </Space>
      }
      className="mb-6"
    >
      <Alert
        type="warning"
        showIcon
        className="mb-4"
        message="高权限日期操作"
        description="这里会直接修改数据库中同一日期的指标、流动性和热门币数据。删除操作会移除该日期整天数据。"
      />

      <Form layout="vertical">
        <Space wrap align="end">
          <Form.Item label="目标日期" className="mb-0">
            <DatePicker
              value={selectedDate}
              onChange={handleDateChange}
              format="YYYY-MM-DD"
              placeholder="选择日期"
            />
          </Form.Item>

          <Form.Item label="时间精度" className="mb-0">
            <Select
              value={timePrecision}
              onChange={handlePrecisionChange}
              style={{ width: 120 }}
            >
              <Option value="day">日</Option>
              <Option value="hour">小时</Option>
              <Option value="minute">分钟</Option>
            </Select>
          </Form.Item>

          {timePrecision !== 'day' && (
            <Form.Item label="具体时间" className="mb-0">
              <TimePicker
                value={selectedTime}
                onChange={setSelectedTime}
                format={timePrecision === 'hour' ? 'HH' : 'HH:mm'}
                showNow={false}
                placeholder={timePrecision === 'hour' ? '选择小时' : '选择时间'}
              />
            </Form.Item>
          )}

          <Button
            icon={<ReloadOutlined />}
            onClick={() => loadSummary()}
            loading={loading}
            disabled={!selectedDateStr}
          >
            查询
          </Button>

          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleUpdateTime}
            loading={saving}
            disabled={!selectedDateStr || totalRecords === 0}
          >
            更新时间
          </Button>

          <Popconfirm
            title={`删除 ${selectedDateStr || '所选日期'} 整天数据`}
            description="该操作会删除这一天的指标、流动性和热门币记录。"
            okText="确认删除"
            cancelText="取消"
            okType="danger"
            onConfirm={handleDeleteDate}
            disabled={!selectedDateStr || totalRecords === 0}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={deleting}
              disabled={!selectedDateStr || totalRecords === 0}
            >
              删除整天数据
            </Button>
          </Popconfirm>
        </Space>
      </Form>

      {summary && (
        <Descriptions
          size="small"
          bordered
          className="mt-4"
          column={{ xs: 1, sm: 2, md: 4 }}
        >
          <Descriptions.Item label="日期">{summary.date}</Descriptions.Item>
          <Descriptions.Item label="指标记录">{summary.counts.dailyMetrics}</Descriptions.Item>
          <Descriptions.Item label="流动性记录">{summary.counts.liquidityOverviews}</Descriptions.Item>
          <Descriptions.Item label="热门币记录">{summary.counts.trendingCoins}</Descriptions.Item>
        </Descriptions>
      )}

      {summary && totalRecords === 0 && (
        <Text type="secondary" className="block mt-3">
          该日期暂无可管理数据。
        </Text>
      )}
    </Card>
  );
}

export default DateDataManagement;
