// src/components/OtcIndexTable.jsx - Mobile-friendly version
import React, { useState, useEffect } from 'react';
import { Table, Typography, Tag, Tooltip, Badge, Button, Card, List, Collapse } from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  RightOutlined
} from '@ant-design/icons';

const { Title, Text } = Typography;
const { Panel } = Collapse;

function OtcIndexTable({ coins, loading = false }) {
  const [sortedInfo, setSortedInfo] = useState({
    columnKey: 'otcIndex',
    order: 'descend',
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Listen for window resize to adjust for mobile
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle table sort change
  const handleChange = (pagination, filters, sorter) => {
    setSortedInfo(sorter);
  };

  // Prepare table data (moved before getSortedData to be accessible)
  const tableData = coins.map((coin, index) => ({
    key: `${coin.symbol}-${index}`,
    symbol: coin.symbol,
    otcIndex: coin.otcIndex,
    explosionIndex: coin.explosionIndex,
    schellingPoint: coin.schellingPoint,
    entryExitType: coin.entryExitType,
    entryExitDay: coin.entryExitDay,
    previousDayData: coin.previousDayData,
    explosionIndexChangePercent: coin.explosionIndexChangePercent,
    otcIndexChangePercent: coin.otcIndexChangePercent
  }));

  // Sort data based on current sort settings
  const getSortedData = () => {
    const sortKey = sortedInfo.columnKey || 'otcIndex';
    const sortOrder = sortedInfo.order === 'ascend' ? 1 : -1;

    return [...tableData].sort((a, b) => {
      // Ensure a and b, and their sortKey properties are defined
      if (a === undefined || a[sortKey] === undefined) return 1;
      if (b === undefined || b[sortKey] === undefined) return -1;

      // Attempt to parse as float for numeric comparison
      const valA = parseFloat(a[sortKey]);
      const valB = parseFloat(b[sortKey]);

      // Handle cases where parsing might result in NaN (e.g., non-numeric strings)
      // If valA is NaN, it should be placed after non-NaN values (or at the end if both are NaN)
      if (isNaN(valA)) return isNaN(valB) ? 0 : 1;
      // If valB is NaN, it should be placed after non-NaN values
      if (isNaN(valB)) return -1;

      return (valA - valB) * sortOrder;
    });
  };


  // Table columns
  const columns = [
    {
      title: '币种',
      dataIndex: 'symbol',
      key: 'symbol',
      fixed: 'left',
      width: 140,
      render: (text, record) => (
        <div className="flex items-center">
          <span className="font-medium">{text}</span>
          {record.entryExitType && record.entryExitType !== 'neutral' && (
            <Tag
              color={record.entryExitType === 'entry' ? 'success' : 'error'}
              className="ml-2"
            >
              {record.entryExitType === 'entry' ? '进' : '退'}{record.entryExitDay}
            </Tag>
          )}
        </div>
      )
    },
    {
      title: '场外指数',
      dataIndex: 'otcIndex',
      key: 'otcIndex',
      width: 170,
      sorter: (a, b) => (parseFloat(a.otcIndex) || 0) - (parseFloat(b.otcIndex) || 0),
      sortOrder: sortedInfo.columnKey === 'otcIndex' ? sortedInfo.order : null,
      render: (value, record) => {
        const numericValue = parseFloat(value); // Ensure value is a number for comparisons
        const isNear1000 = numericValue > 950 && numericValue < 1050;
        const prevData = record.previousDayData;
        const prevOtcIndex = prevData ? parseFloat(prevData.otc_index) : undefined;


        return (
          <div className="flex items-center">
            <span className={`text-blue-600 font-medium ${isNear1000 ? 'text-orange-500' : ''}`}>
              {numericValue}
            </span>

            {prevData && prevOtcIndex !== undefined && !isNaN(prevOtcIndex) && (
              <Tooltip title={`前一天: ${prevOtcIndex}`}>
                <span className="ml-2">
                  {numericValue > prevOtcIndex ? (
                    <Badge
                      count={<ArrowUpOutlined style={{ fontSize: '12px', color: '#52c41a' }} />}
                      style={{ backgroundColor: '#f6ffed', boxShadow: 'none' }}
                    />
                  ) : numericValue < prevOtcIndex ? (
                    <Badge
                      count={<ArrowDownOutlined style={{ fontSize: '12px', color: '#ff4d4f' }} />}
                      style={{ backgroundColor: '#fff1f0', boxShadow: 'none' }}
                    />
                  ) : null}
                </span>
              </Tooltip>
            )}

            {numericValue >= 1000 && (
              <Tooltip title="场外指数超过1000，最后加仓时机">
                <Tag color="gold" className="ml-2">1000+</Tag>
              </Tooltip>
            )}
          </div>
        );
      }
    },
    {
      title: '爆破指数',
      dataIndex: 'explosionIndex',
      key: 'explosionIndex',
      width: 180,
      sorter: (a, b) => (parseFloat(a.explosionIndex) || 0) - (parseFloat(b.explosionIndex) || 0),
      sortOrder: sortedInfo.columnKey === 'explosionIndex' ? sortedInfo.order : null,
      render: (value, record) => {
        const numericValue = parseFloat(value); // Ensure value is a number
        const isWarning = numericValue < 200;
        const prevData = record.previousDayData;
        const prevExplosionIndex = prevData ? parseFloat(prevData.explosion_index) : undefined;

        // Debug log, can be removed after testing
        // if (record.symbol === 'SOL' && prevData && prevExplosionIndex !== undefined) {
        //   console.log(`SOL Explosion: Current=${numericValue}, Prev=${prevExplosionIndex}, Current > Prev? ${numericValue > prevExplosionIndex}`);
        // }

        const wasNegative = prevData && prevExplosionIndex !== undefined && !isNaN(prevExplosionIndex) && prevExplosionIndex < 0;
        const turnedPositive = wasNegative && numericValue > 0;
        const brokeThreshold = prevData && prevExplosionIndex !== undefined && !isNaN(prevExplosionIndex) && prevExplosionIndex >= 200 && numericValue < 200;

        return (
          <div className="flex items-center">
            <span className={isWarning ? 'text-red-600' : 'text-green-600'}>
              {numericValue}
            </span>

            {prevData && prevExplosionIndex !== undefined && !isNaN(prevExplosionIndex) && (
              <Tooltip title={`前一天: ${prevExplosionIndex}`}>
                <span className="ml-2">
                  {turnedPositive ? (
                    <Tag color="success" className="ml-1">负转正</Tag>
                  ) : brokeThreshold ? (
                    <Tag color="error" className="ml-1">跌破200</Tag>
                  ) : numericValue > prevExplosionIndex ? (
                    <Badge
                      count={<ArrowUpOutlined style={{ fontSize: '12px', color: '#52c41a' }} />}
                      style={{ backgroundColor: '#f6ffed', boxShadow: 'none' }}
                    />
                  ) : numericValue < prevExplosionIndex ? (
                    <Badge
                      count={<ArrowDownOutlined style={{ fontSize: '12px', color: '#ff4d4f' }} />}
                      style={{ backgroundColor: '#fff1f0', boxShadow: 'none' }}
                    />
                  ) : null}
                </span>
              </Tooltip>
            )}

            {isWarning && (
              <Tooltip title="爆破指数低于200，处于风险区域">
                <WarningOutlined className="ml-2 text-amber-500" />
              </Tooltip>
            )}
          </div>
        );
      }
    },
    {
      title: '谢林点',
      dataIndex: 'schellingPoint',
      key: 'schellingPoint',
      width: 150,
      sorter: (a, b) => (parseFloat(a.schellingPoint) || 0) - (parseFloat(b.schellingPoint) || 0),
      sortOrder: sortedInfo.columnKey === 'schellingPoint' ? sortedInfo.order : null,
      render: (value) => {
        const numericValue = parseFloat(value);
        return (
          <span className="text-purple-600">
            {typeof numericValue === 'number' && !isNaN(numericValue) ? (
              numericValue > 1000 ?
                numericValue.toLocaleString() :
                numericValue.toFixed(numericValue < 1 ? 3 : numericValue < 10 ? 2 : 0)
            ) : '-'}
          </span>
        )
      }
    },
    {
      title: '交易建议',
      key: 'suggestion',
      width: 200,
      render: (_, record) => {
        const prevData = record.previousDayData;
        if (!prevData) return <Text type="secondary">数据不足</Text>;

        const currExplosionIndex = parseFloat(record.explosionIndex);
        const prevExplosionIndex = prevData.explosion_index !== undefined && prevData.explosion_index !== null ? parseFloat(prevData.explosion_index) : undefined;

        if (isNaN(currExplosionIndex) || (prevExplosionIndex !== undefined && isNaN(prevExplosionIndex))) {
            return <Text type="secondary">数据错误</Text>;
        }

        // Long: explosion index turns positive or new entry
        if (prevExplosionIndex < 0 && currExplosionIndex > 0) {
          return (
            <Tag color="success" className="px-2 py-1">
              做多：爆破指数由负转正
            </Tag>
          );
        }

        if (record.entryExitType === 'entry' && record.entryExitDay <= 3) {
          return (
            <Tag color="success" className="px-2 py-1">
              做多：进场期初期
            </Tag>
          );
        }

        // Short: explosion index drops below 200 or new exit
        if (prevExplosionIndex >= 200 && currExplosionIndex < 200) {
          return (
            <Tag color="error" className="px-2 py-1">
              做空：爆破指数跌破200
            </Tag>
          );
        }

        if (record.entryExitType === 'exit' && record.entryExitDay === 1) {
          return (
            <Tag color="error" className="px-2 py-1">
              做空：退场期第一天
            </Tag>
          );
        }

        // Default suggestion
        return (
          <Text type="secondary">
            {currExplosionIndex >= 200 ? "观望" : "风险注意"}
          </Text>
        );
      }
    }
  ];

  // Sorting options for mobile
  const sortOptions = [
    { label: '场外指数从高到低', value: 'otcIndex-desc' },
    { label: '场外指数从低到高', value: 'otcIndex-asc' },
    { label: '爆破指数从高到低', value: 'explosionIndex-desc' },
    { label: '爆破指数从低到高', value: 'explosionIndex-asc' },
    { label: '谢林点从高到低', value: 'schellingPoint-desc' },
    { label: '谢林点从低到高', value: 'schellingPoint-asc' }
  ];

  // Handle mobile sort change
  const handleMobileSortChange = (value) => {
    const [field, order] = value.split('-');
    setSortedInfo({
      columnKey: field,
      order: order === 'asc' ? 'ascend' : 'descend'
    });
  };

  // Render sort type label
  const renderSortLabel = () => {
    const field = sortedInfo.columnKey || 'otcIndex';
    const order = sortedInfo.order === 'ascend' ? '从低到高' : '从高到低';

    const fieldLabels = {
      'otcIndex': '场外指数',
      'explosionIndex': '爆破指数',
      'schellingPoint': '谢林点'
    };

    return `${fieldLabels[field] || field} ${order}`;
  };

  // Mobile coin list item renderer
  const renderCoinListItem = (coin) => {
    const numericExplosionIndex = parseFloat(coin.explosionIndex);
    const isExplosionSafe = numericExplosionIndex >= 200;
    const prevData = coin.previousDayData;
    const prevOtcIndex = prevData ? parseFloat(prevData.otc_index) : undefined;
    const prevExplosionIndex = prevData ? parseFloat(prevData.explosion_index) : undefined;


    // Trading suggestion
    let suggestion = '';
    let suggestionColor = '';
    if (prevData && !isNaN(numericExplosionIndex) && (prevExplosionIndex === undefined || !isNaN(prevExplosionIndex))) {
      const currExplosionIndex = numericExplosionIndex;

      if (prevExplosionIndex < 0 && currExplosionIndex > 0) {
        suggestion = '做多：爆破指数由负转正';
        suggestionColor = 'success';
      } else if (coin.entryExitType === 'entry' && coin.entryExitDay <= 3) {
        suggestion = '做多：进场期初期';
        suggestionColor = 'success';
      } else if (prevExplosionIndex >= 200 && currExplosionIndex < 200) {
        suggestion = '做空：爆破指数跌破200';
        suggestionColor = 'error';
      } else if (coin.entryExitType === 'exit' && coin.entryExitDay === 1) {
        suggestion = '做空：退场期第一天';
        suggestionColor = 'error';
      } else {
        suggestion = currExplosionIndex >= 200 ? "观望" : "风险注意";
      }
    } else if (!prevData) {
        suggestion = "数据不足";
    }


    return (
      <List.Item
        className="px-3 py-2 border-b"
      >
        <div className="w-full">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <span className="font-medium">{coin.symbol}</span>
              {coin.entryExitType && coin.entryExitType !== 'neutral' && (
                <Tag
                  color={coin.entryExitType === 'entry' ? 'success' : 'error'}
                  className="ml-2"
                >
                  {coin.entryExitType === 'entry' ? '进' : '退'}{coin.entryExitDay}
                </Tag>
              )}
            </div>

            {suggestionColor ? (
              <Tag color={suggestionColor}>{suggestion}</Tag>
            ) : (
              <Text type="secondary">{suggestion || '数据不足'}</Text>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <Text type="secondary" className="text-xs">场外指数:</Text>
              <div className="flex items-center">
                <span className="text-blue-600 font-medium">{parseFloat(coin.otcIndex) || 0}</span>
                {prevData && prevOtcIndex !== undefined && !isNaN(prevOtcIndex) && (
                  <span className="ml-1">
                    {(parseFloat(coin.otcIndex) || 0) > prevOtcIndex ? (
                      <Badge
                        count={<ArrowUpOutlined style={{ fontSize: '10px', color: '#52c41a' }} />}
                        style={{ backgroundColor: '#f6ffed', boxShadow: 'none' }}
                      />
                    ) : (parseFloat(coin.otcIndex) || 0) < prevOtcIndex ? (
                      <Badge
                        count={<ArrowDownOutlined style={{ fontSize: '10px', color: '#ff4d4f' }} />}
                        style={{ backgroundColor: '#fff1f0', boxShadow: 'none' }}
                      />
                    ) : null}
                  </span>
                )}
                {(parseFloat(coin.otcIndex) || 0) >= 1000 && (
                  <Tag color="gold" className="ml-1 text-xs">1000+</Tag>
                )}
              </div>
            </div>

            <div>
              <Text type="secondary" className="text-xs">爆破指数:</Text>
              <div className="flex items-center">
                <span className={isExplosionSafe ? 'text-green-600' : 'text-red-600'}>
                  {numericExplosionIndex}
                </span>
                {prevData && prevExplosionIndex !== undefined && !isNaN(prevExplosionIndex) && (
                  <span className="ml-1">
                    {prevExplosionIndex < 0 && numericExplosionIndex > 0 ? (
                      <Tag color="success" className="ml-1 text-xs">负转正</Tag>
                    ) : prevExplosionIndex >= 200 && numericExplosionIndex < 200 ? (
                      <Tag color="error" className="ml-1 text-xs">跌破200</Tag>
                    ) : numericExplosionIndex > prevExplosionIndex ? (
                      <Badge
                        count={<ArrowUpOutlined style={{ fontSize: '10px', color: '#52c41a' }} />}
                        style={{ backgroundColor: '#f6ffed', boxShadow: 'none' }}
                      />
                    ) : numericExplosionIndex < prevExplosionIndex ? (
                      <Badge
                        count={<ArrowDownOutlined style={{ fontSize: '10px', color: '#ff4d4f' }} />}
                        style={{ backgroundColor: '#fff1f0', boxShadow: 'none' }}
                      />
                    ) : null}
                  </span>
                )}
                {!isExplosionSafe && (
                  <WarningOutlined className="ml-1 text-amber-500" />
                )}
              </div>
            </div>
          </div>

          <div className="mt-1">
            <Text type="secondary" className="text-xs">谢林点:</Text>
            <span className="text-purple-600 ml-1">
              {typeof parseFloat(coin.schellingPoint) === 'number' && !isNaN(parseFloat(coin.schellingPoint)) ? (
                parseFloat(coin.schellingPoint) > 1000 ?
                  Intl.NumberFormat('en', { notation: 'compact' }).format(parseFloat(coin.schellingPoint)) :
                  parseFloat(coin.schellingPoint).toFixed(parseFloat(coin.schellingPoint) < 1 ? 3 : parseFloat(coin.schellingPoint) < 10 ? 2 : 0)
              ) : '-'}
            </span>
          </div>
        </div>
      </List.Item>
    );
  };

  return (
    <div className="mt-4 bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-4">
        <Title level={4} className="mb-0">场外指数表</Title>
        <Tooltip title="点击表头可以对数据进行排序">
          <Button
            type="text"
            icon={<InfoCircleOutlined />}
            className="text-gray-400"
          />
        </Tooltip>
      </div>

      {isMobile ? (
        // Mobile view - List with Collapse for sorting
        <div>
          <Collapse ghost className="mb-3">
            <Panel
              header={
                <div className="flex items-center justify-between">
                  <span>排序方式: {renderSortLabel()}</span>
                  <RightOutlined />
                </div>
              }
              key="1"
            >
              <div className="grid grid-cols-1 gap-2">
                {sortOptions.map(option => (
                  <Button
                    key={option.value}
                    type={sortedInfo.columnKey === option.value.split('-')[0] &&
                          sortedInfo.order === (option.value.split('-')[1] === 'asc' ? 'ascend' : 'descend') ?
                          'primary' : 'default'}
                    block
                    onClick={() => handleMobileSortChange(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </Panel>
          </Collapse>

          <List
            dataSource={getSortedData()}
            renderItem={renderCoinListItem}
            loading={loading}
            locale={{ emptyText: '没有找到匹配的数据' }}
          />

          {/* Legend */}
          <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-2">
            <div className="flex items-center">
              <Badge
                count={<ArrowUpOutlined style={{ fontSize: '10px', color: '#52c41a' }} />}
                style={{ backgroundColor: '#f6ffed', boxShadow: 'none' }}
              />
              <Text className="ml-1">高于前一天</Text>
            </div>
            <div className="flex items-center">
              <Badge
                count={<ArrowDownOutlined style={{ fontSize: '10px', color: '#ff4d4f' }} />}
                style={{ backgroundColor: '#fff1f0', boxShadow: 'none' }}
              />
              <Text className="ml-1">低于前一天</Text>
            </div>
            <div className="flex items-center">
              <Tag color="success" className="text-xs">负转正</Tag>
              <Text className="ml-1">爆破指数由负转正</Text>
            </div>
            <div className="flex items-center">
              <Tag color="error" className="text-xs">跌破200</Tag>
              <Text className="ml-1">爆破指数跌破200</Text>
            </div>
          </div>
        </div>
      ) : (
        // Desktop view - Table
        <>
          <Table
            columns={columns}
            dataSource={tableData}
            pagination={tableData.length > 10 ? { pageSize: 10 } : false}
            size="middle"
            className="overflow-x-auto"
            loading={loading}
            onChange={handleChange}
            scroll={{ x: 650 }}
          />

          {/* Legend for desktop */}
          <div className="mt-3 text-xs text-gray-500 flex flex-col md:flex-row gap-2 md:gap-6">
            <div>
              <Badge
                count={<ArrowUpOutlined style={{ fontSize: '10px', color: '#52c41a' }} />}
                style={{ backgroundColor: '#f6ffed', boxShadow: 'none' }}
              />
              <Text className="ml-1">高于前一天</Text>
            </div>
            <div>
              <Badge
                count={<ArrowDownOutlined style={{ fontSize: '10px', color: '#ff4d4f' }} />}
                style={{ backgroundColor: '#fff1f0', boxShadow: 'none' }}
              />
              <Text className="ml-1">低于前一天</Text>
            </div>
            <div>
              <Tag color="success" className="text-xs">负转正</Tag>
              <Text className="ml-1">爆破指数由负转正</Text>
            </div>
            <div>
              <Tag color="error" className="text-xs">跌破200</Tag>
              <Text className="ml-1">爆破指数跌破200</Text>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default OtcIndexTable;