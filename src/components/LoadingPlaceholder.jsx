// src/components/LoadingPlaceholder.jsx
import React from 'react';
import { Spin } from 'antd';

function LoadingPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center py-10">
      <Spin size="large" />
      <div className="mt-4 text-gray-500">加载中...</div>
    </div>
  );
}

export default LoadingPlaceholder;