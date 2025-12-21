// server/routes/docs.js - API文档路由
const express = require('express');
const router = express.Router();

// API文档数据
const apiDocs = {
  title: "Crypto Metrics Dashboard API",
  version: "1.0.0",
  description: "加密货币指标仪表板的后端API文档",
  baseUrl: "/api",
  endpoints: [
    {
      category: "Public (No Auth)",
      endpoints: [
        {
          method: "GET",
          path: "/public/top-otc-crypto",
          description: "Top 5 crypto by OTC index for the latest date (no auth).",
          response: {
            success: "boolean",
            date: "string - data date",
            count: "number - item count",
            items: "array - { symbol, name, otc_index, period_quality, time, date, timestamp }"
          }
        },
        {
          method: "GET",
          path: "/public/bottom-otc-crypto",
          description: "Bottom 5 crypto by OTC index for the latest date (no auth).",
          response: {
            success: "boolean",
            date: "string - data date",
            count: "number - item count",
            items: "array - { symbol, name, otc_index, period_quality, time, date, timestamp }"
          }
        }
      ]
    },
    {
      category: "认证 (Authentication)",
      endpoints: [
        {
          method: "POST",
          path: "/auth/register",
          description: "用户注册",
          body: {
            username: "string - 用户名",
            password: "string - 密码",
            email: "string - 邮箱"
          },
          response: {
            success: "boolean",
            message: "string",
            user: "object - 用户信息（注册成功时）"
          }
        },
        {
          method: "POST",
          path: "/auth/login",
          description: "用户登录",
          body: {
            username: "string - 用户名",
            password: "string - 密码"
          },
          response: {
            success: "boolean",
            token: "string - JWT令牌",
            user: "object - 用户信息"
          }
        },
        {
          method: "GET",
          path: "/auth/verify",
          description: "验证JWT令牌",
          headers: {
            Authorization: "Bearer <token>"
          },
          response: {
            success: "boolean",
            user: "object - 用户信息"
          }
        },
        {
          method: "PUT",
          path: "/auth/change-password",
          description: "修改密码",
          body: {
            currentPassword: "string - 当前密码",
            newPassword: "string - 新密码",
            userId: "number - 用户ID"
          },
          response: {
            success: "boolean",
            message: "string"
          }
        }
      ]
    },
    {
      category: "币种管理 (Coins)",
      endpoints: [
        {
          method: "GET",
          path: "/coins",
          description: "获取所有币种列表",
          response: {
            success: "boolean",
            coins: "array - 币种列表"
          }
        },
        {
          method: "GET",
          path: "/coins/:symbol",
          description: "获取单个币种信息",
          params: {
            symbol: "string - 币种符号 (如: BTC, ETH)"
          },
          response: {
            success: "boolean",
            coin: "object - 币种信息"
          }
        },
        {
          method: "GET",
          path: "/coins/:symbol/metrics",
          description: "获取指定币种的历史指标数据",
          params: {
            symbol: "string - 币种符号 (如: BTC, ETH)"
          },
          query: {
            startDate: "string - 开始日期 (YYYY-MM-DD)",
            endDate: "string - 结束日期 (YYYY-MM-DD)"
          },
          response: "array - 历史指标数据"
        },
        {
          method: "POST",
          path: "/coins",
          description: "创建新币种",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          body: {
            symbol: "string - 币种符号",
            name: "string - 币种名称",
            current_price: "number - 当前价格",
            logo_url: "string - 图标URL"
          },
          response: {
            success: "boolean",
            coin: "object - 创建的币种信息"
          }
        },
        {
          method: "PUT",
          path: "/coins/:id",
          description: "更新币种信息",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          params: {
            id: "number - 币种ID"
          },
          body: {
            symbol: "string - 币种符号",
            name: "string - 币种名称",
            current_price: "number - 当前价格",
            logo_url: "string - 图标URL"
          },
          response: {
            success: "boolean",
            coin: "object - 更新后的币种信息"
          }
        },
        {
          method: "DELETE",
          path: "/coins/:id",
          description: "删除币种",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          params: {
            id: "number - 币种ID"
          },
          response: {
            success: "boolean",
            message: "string"
          }
        }
      ]
    },
    {
      category: "仪表盘 (Dashboard)",
      endpoints: [
        {
          method: "GET",
          path: "/dashboard",
          description: "获取仪表盘数据",
          query: {
            date: "string - 可选，指定日期 (YYYY-MM-DD)，默认为今天"
          },
          response: {
            success: "boolean",
            data: "object - 仪表盘数据",
            date: "string - 数据日期"
          }
        },
        {
          method: "GET",
          path: "/dashboard/trends",
          description: "获取历史数据趋势",
          query: {
            symbol: "string - 币种符号",
            metric: "string - 指标类型 (otc_index, explosion_index, schelling_point)",
            startDate: "string - 开始日期 (YYYY-MM-DD)",
            endDate: "string - 结束日期 (YYYY-MM-DD)",
            limit: "number - 限制返回数量"
          },
          response: {
            success: "boolean",
            trends: "array - 趋势数据"
          }
        }
      ]
    },
    {
      category: "指标数据 (Metrics)",
      endpoints: [
        {
          method: "GET",
          path: "/metrics",
          description: "获取所有指标数据",
          query: {
            date: "string - 可选，指定日期 (YYYY-MM-DD)",
            symbol: "string - 可选，币种符号",
            limit: "number - 可选，限制返回数量"
          },
          response: {
            success: "boolean",
            metrics: "array - 指标数据列表"
          }
        },
        {
          method: "POST",
          path: "/metrics",
          description: "创建新的指标数据",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          body: {
            coin_id: "number - 币种ID",
            date: "string - 日期 (YYYY-MM-DD)",
            otc_index: "number - 场外指数",
            explosion_index: "number - 爆破指数",
            schelling_point: "number - 谢林点",
            entry_exit_type: "string - 进退场类型",
            entry_exit_day: "number - 进退场天数",
            near_threshold: "boolean - 是否接近阈值"
          },
          response: {
            success: "boolean",
            metric: "object - 创建的指标数据"
          }
        }
      ]
    },
    {
      category: "数据管理 (Data)",
      endpoints: [
        {
          method: "GET",
          path: "/data",
          description: "获取最新的仪表板数据",
          response: {
            success: "boolean",
            coins: "array - 币种数据",
            liquidity: "object - 流动性概览",
            trending: "array - 热门币种",
            date: "string - 数据日期"
          }
        },
        {
          method: "GET",
          path: "/data/latest",
          description: "获取最新数据（增强版，包含前一天对比和百分比变化）",
          response: {
            success: "boolean",
            date: "string - 最新数据日期",
            previousDate: "string - 前一天日期",
            coins: "array - 币种数据（包含变化百分比和质量判断）",
            liquidityOverview: "object - 流动性概览",
            trendingCoins: "array - 热门币种",
            totalCoins: "number - 币种总数"
          }
        },
        {
          method: "GET",
          path: "/data/by-date/:date",
          description: "获取指定日期的历史数据",
          params: {
            date: "string - 日期 (YYYY-MM-DD)"
          },
          response: {
            success: "boolean",
            date: "string - 数据日期",
            previousDate: "string - 前一天日期",
            coins: "array - 币种数据（包含完整质量判断）",
            liquidityOverview: "object - 流动性概览",
            trendingCoins: "array - 热门币种",
            totalCoins: "number - 币种总数"
          }
        },
        {
          method: "POST",
          path: "/data/input",
          description: "提交新的数据",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          body: {
            rawData: "string - 原始数据"
          },
          response: {
            success: "boolean",
            message: "string"
          }
        },
        {
          method: "GET",
          path: "/data/export-all",
          description: "导出所有数据库数据",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          response: {
            metadata: "object - 导出元数据",
            allCoinsInfo: "array - 所有币种信息",
            allHistoricalMetricsRaw: "array - 所有历史指标数据",
            allLiquidityHistory: "array - 所有流动性历史",
            allTrendingCoinsHistory: "array - 所有热门币种历史",
            latestProcessedData: "object - 最新处理过的数据"
          }
        },
        {
          method: "POST",
          path: "/data/import-database",
          description: "批量导入数据库备份数据",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          body: {
            metadata: "object - 导入元数据",
            allCoinsInfo: "array - 币种信息",
            allHistoricalMetricsRaw: "array - 历史指标数据",
            allLiquidityHistory: "array - 流动性历史",
            allTrendingCoinsHistory: "array - 热门币种历史"
          },
          response: {
            success: "boolean",
            message: "string",
            importSummary: "object - 导入摘要"
          }
        }
      ]
    },
    {
      category: "流动性数据 (Liquidity)",
      endpoints: [
        {
          method: "GET",
          path: "/liquidity",
          description: "获取所有流动性概览数据",
          query: {
            date: "string - 可选，指定日期 (YYYY-MM-DD)"
          },
          response: {
            success: "boolean",
            data: "array - 流动性历史数据"
          }
        },
        {
          method: "GET",
          path: "/liquidity/:date",
          description: "获取特定日期的流动性概览",
          params: {
            date: "string - 日期 (YYYY-MM-DD)"
          },
          response: {
            success: "boolean",
            data: "object - 流动性数据"
          }
        },
        {
          method: "POST",
          path: "/liquidity",
          description: "添加或更新流动性概览",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          body: {
            date: "string - 日期 (YYYY-MM-DD)",
            btc_fund_change: "number - BTC资金变化",
            eth_fund_change: "number - ETH资金变化",
            sol_fund_change: "number - SOL资金变化",
            total_market_fund_change: "number - 总市场资金变化",
            comments: "string - 评论",
            daily_reminder: "string - 每日提醒"
          },
          response: {
            success: "boolean",
            data: "object - 创建/更新的流动性数据"
          }
        },
        {
          method: "DELETE",
          path: "/liquidity/:date",
          description: "删除流动性概览",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          params: {
            date: "string - 日期 (YYYY-MM-DD)"
          },
          response: {
            success: "boolean",
            message: "string"
          }
        }
      ]
    },
    {
      category: "收藏功能 (Favorites)",
      endpoints: [
        {
          method: "GET",
          path: "/favorites",
          description: "获取用户收藏的币种",
          headers: {
            Authorization: "Bearer <token> - 可选，用于用户收藏"
          },
          query: {
            deviceId: "string - 设备ID（未登录用户）"
          },
          response: {
            success: "boolean",
            favorites: "array - 收藏列表"
          }
        },
        {
          method: "POST",
          path: "/favorites",
          description: "添加收藏",
          headers: {
            Authorization: "Bearer <token> - 可选"
          },
          body: {
            symbol: "string - 币种符号",
            deviceId: "string - 设备ID（未登录用户）"
          },
          response: {
            success: "boolean",
            message: "string"
          }
        },
        {
          method: "DELETE",
          path: "/favorites/:symbol",
          description: "删除收藏",
          params: {
            symbol: "string - 币种符号"
          },
          query: {
            deviceId: "string - 设备ID（未登录用户）"
          },
          response: {
            success: "boolean",
            message: "string"
          }
        }
      ]
    },
    {
      category: "调试工具 (Debug)",
      endpoints: [
        {
          method: "GET",
          path: "/debug/db-status",
          description: "获取数据库状态和统计信息",
          response: {
            success: "boolean",
            coins: "array - 币种列表",
            totalCoins: "number - 币种总数",
            totalMetrics: "number - 指标记录总数",
            dateRange: "object - 数据日期范围",
            latestData: "object - 最新数据信息"
          }
        },
        {
          method: "GET",
          path: "/data/debug/date-range",
          description: "获取数据库中的日期范围",
          response: {
            success: "boolean",
            dateRange: "object - 日期范围信息"
          }
        },
        {
          method: "POST",
          path: "/data/debug/add-test-data",
          description: "添加测试数据（仅开发环境）",
          headers: {
            Authorization: "Bearer <token> - 需要管理员权限"
          },
          body: {
            testData: "object - 测试数据"
          },
          response: {
            success: "boolean",
            message: "string"
          },
          note: "此端点在生产环境中被禁用"
        }
      ]
    }
  ],
  dataModels: {
    Coin: {
      id: "number - 币种ID",
      symbol: "string - 币种符号",
      name: "string - 币种名称",
      current_price: "number - 当前价格",
      logo_url: "string - 图标URL",
      created_at: "string - 创建时间",
      updated_at: "string - 更新时间"
    },
    DailyMetric: {
      id: "number - 记录ID",
      coin_id: "number - 币种ID",
      date: "string - 日期 (YYYY-MM-DD)",
      otc_index: "number - 场外指数",
      explosion_index: "number - 爆破指数",
      schelling_point: "number - 谢林点",
      entry_exit_type: "string - 进退场类型 (entry/exit/neutral)",
      entry_exit_day: "number - 进退场天数",
      near_threshold: "boolean - 是否接近阈值",
      timestamp: "string - 时间戳",
      time_precision: "string - 时间精度",
      period_quality: "string - 周期质量判断",
      created_at: "string - 创建时间",
      updated_at: "string - 更新时间"
    },
    LiquidityOverview: {
      id: "number - 记录ID",
      date: "string - 日期 (YYYY-MM-DD)",
      btc_fund_change: "number - BTC资金变化",
      eth_fund_change: "number - ETH资金变化",
      sol_fund_change: "number - SOL资金变化",
      total_market_fund_change: "number - 总市场资金变化",
      comments: "string - 评论",
      daily_reminder: "string - 每日提醒",
      created_at: "string - 创建时间",
      updated_at: "string - 更新时间"
    },
    User: {
      id: "number - 用户ID",
      username: "string - 用户名",
      email: "string - 邮箱",
      role: "string - 用户角色 (admin/user)",
      created_at: "string - 创建时间",
      updated_at: "string - 更新时间"
    },
    Favorite: {
      id: "number - 收藏ID",
      user_id: "number - 用户ID (可选)",
      device_id: "string - 设备ID (可选)",
      symbol: "string - 币种符号",
      created_at: "string - 创建时间"
    },
    "API响应格式": {
      success: "boolean - 请求是否成功",
      message: "string - 响应消息 (可选)",
      data: "any - 响应数据 (可选)",
      error: "string - 错误信息 (失败时)"
    },
    "质量判断类型": {
      "高质量进场": "相邻关键节点间场外指数稳步上升",
      "低质量进场": "相邻关键节点间场外指数蜿蜒反复、下降或持平",
      "高质量退场": "相邻关键节点间场外指数稳步下降",
      "低质量退场": "相邻关键节点间场外指数出现反复、上升或持平",
      "观望": "既不在进场期也不在退场期",
      "进场期 (待观察)": "进场期但尚未出现关键节点",
      "退场期 (待观察)": "退场期但尚未出现关键节点",
      "数据不足": "历史数据不足以进行质量判断",
      "计算出错": "质量计算过程中出现错误"
    }
  }
};

// 获取API文档
router.get('/', (req, res) => {
  res.json(apiDocs);
});

// 获取HTML格式的API文档
router.get('/html', (req, res) => {
  const html = generateHtmlDocs(apiDocs);
  res.send(html);
});

// 生成HTML文档的函数
function generateHtmlDocs(docs) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${docs.title}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }
        h2 {
            color: #34495e;
            margin-top: 30px;
            border-left: 4px solid #3498db;
            padding-left: 15px;
        }
        h3 {
            color: #2980b9;
            margin-top: 25px;
        }
        .endpoint {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 5px;
            padding: 15px;
            margin: 15px 0;
        }
        .method {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 3px;
            font-weight: bold;
            font-size: 12px;
            margin-right: 10px;
        }
        .method.GET { background: #28a745; color: white; }
        .method.POST { background: #007bff; color: white; }
        .method.PUT { background: #ffc107; color: black; }
        .method.DELETE { background: #dc3545; color: white; }
        .path {
            font-family: 'Courier New', monospace;
            background: #e9ecef;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: bold;
        }
        .description {
            margin: 10px 0;
            color: #666;
        }
        .params, .body, .response {
            margin: 10px 0;
        }
        .params h4, .body h4, .response h4 {
            margin: 5px 0;
            color: #495057;
        }
        pre {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 3px;
            padding: 10px;
            overflow-x: auto;
        }
        code {
            background: #f8f9fa;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
        }
        .toc {
            background: #e3f2fd;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .toc ul {
            list-style-type: none;
            padding-left: 0;
        }
        .toc li {
            margin: 5px 0;
        }
        .toc a {
            text-decoration: none;
            color: #1976d2;
        }
        .toc a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${docs.title}</h1>
        <p><strong>版本:</strong> ${docs.version}</p>
        <p><strong>描述:</strong> ${docs.description}</p>
        <p><strong>基础URL:</strong> <code>${docs.baseUrl}</code></p>
        
        <div class="toc">
            <h3>目录</h3>
            <ul>
                ${docs.endpoints.map(category => 
                    `<li><a href="#${category.category.replace(/\s+/g, '-')}">${category.category}</a></li>`
                ).join('')}
                <li><a href="#data-models">数据模型</a></li>
            </ul>
        </div>

        ${docs.endpoints.map(category => `
            <h2 id="${category.category.replace(/\s+/g, '-')}">${category.category}</h2>
            ${category.endpoints.map(endpoint => `
                <div class="endpoint">
                    <div>
                        <span class="method ${endpoint.method}">${endpoint.method}</span>
                        <span class="path">${endpoint.path}</span>
                    </div>
                    <div class="description">${endpoint.description}</div>
                    
                    ${endpoint.params ? `
                        <div class="params">
                            <h4>路径参数:</h4>
                            <pre>${JSON.stringify(endpoint.params, null, 2)}</pre>
                        </div>
                    ` : ''}
                    
                    ${endpoint.query ? `
                        <div class="params">
                            <h4>查询参数:</h4>
                            <pre>${JSON.stringify(endpoint.query, null, 2)}</pre>
                        </div>
                    ` : ''}
                    
                    ${endpoint.headers ? `
                        <div class="params">
                            <h4>请求头:</h4>
                            <pre>${JSON.stringify(endpoint.headers, null, 2)}</pre>
                        </div>
                    ` : ''}
                    
                    ${endpoint.body ? `
                        <div class="body">
                            <h4>请求体:</h4>
                            <pre>${JSON.stringify(endpoint.body, null, 2)}</pre>
                        </div>
                    ` : ''}
                    
                    <div class="response">
                        <h4>响应:</h4>
                        <pre>${JSON.stringify(endpoint.response, null, 2)}</pre>
                    </div>
                </div>
            `).join('')}
        `).join('')}

        <h2 id="data-models">数据模型</h2>
        ${Object.entries(docs.dataModels).map(([modelName, model]) => `
            <h3>${modelName}</h3>
            <pre>${JSON.stringify(model, null, 2)}</pre>
        `).join('')}
        
        <hr style="margin: 40px 0;">
        <p style="text-align: center; color: #666;">
            生成时间: ${new Date().toLocaleString('zh-CN')}
        </p>
    </div>
</body>
</html>
  `;
}

module.exports = router;
