# OpenAI 配置说明

## 环境变量配置

### 必需的环境变量

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `OPENAI_API_KEY` | OpenAI API密钥 | 无 | `sk-xxx...` |

### 可选的环境变量

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `OPENAI_BASE_URL` | OpenAI API基础URL | `https://api.openai.com/v1` | `https://burn.hair/v1` |
| `OPENAI_MODEL` | 使用的AI模型 | `gpt-4o` | `gpt-4o`, `gpt-3.5-turbo` |
| `OPENAI_SYSTEM_PROMPT` | 系统提示词 | 默认中文提示 | 自定义系统提示 |
| `OPENAI_PROMPT` | 完整的用户提示模板 | 使用内置默认模板 | 自定义完整提示 |

## 配置方式

### 1. 使用 .env 文件（开发环境）

在 `server` 目录下创建 `.env` 文件：

```bash
# 基础配置
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://burn.hair/v1

# 可选配置
OPENAI_MODEL=gpt-4o
OPENAI_SYSTEM_PROMPT=你是一个数据清洗专家，请将加密货币指标数据转换为结构化JSON格式。
```

### 2. 使用 Docker Compose（生产环境）

在 `docker-compose.yml` 中配置：

```yaml
environment:
  - OPENAI_API_KEY=your-api-key-here
  - OPENAI_BASE_URL=https://burn.hair/v1
  - OPENAI_MODEL=gpt-4o
  - OPENAI_SYSTEM_PROMPT=你是一个数据清洗专家，请将加密货币指标数据转换为结构化JSON格式。
```

### 3. 自定义完整提示模板

如果需要完全自定义提示模板，可以设置 `OPENAI_PROMPT` 环境变量。在模板中使用 `{{processedText}}` 作为占位符：

```bash
OPENAI_PROMPT="你是专家。处理这些数据：{{processedText}}。返回JSON格式。"
```

## 使用不同的API提供商

### 官方 OpenAI API
```bash
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxx...
```

### 第三方代理服务
```bash
OPENAI_BASE_URL=https://burn.hair/v1
OPENAI_API_KEY=sk-xxx...
```

### 其他兼容的API服务
```bash
OPENAI_BASE_URL=https://your-custom-api.com/v1
OPENAI_API_KEY=your-custom-key
OPENAI_MODEL=your-custom-model
```

## 注意事项

1. **API密钥安全**：请确保不要将API密钥提交到版本控制系统中
2. **模型选择**：不同模型的性能和成本不同，请根据需要选择
3. **提示优化**：可以根据实际数据格式调整提示模板以获得更好的解析效果
4. **错误处理**：如果API调用失败，系统会记录详细的错误信息

## 故障排除

### 常见问题

1. **API密钥无效**
   - 检查 `OPENAI_API_KEY` 是否正确设置
   - 确认API密钥有效且有足够的配额

2. **网络连接问题**
   - 检查 `OPENAI_BASE_URL` 是否可访问
   - 确认防火墙设置允许访问API端点

3. **模型不支持**
   - 确认指定的模型在所使用的API服务中可用
   - 检查API密钥是否有权限访问指定模型

### 调试信息

系统会在控制台输出以下调试信息：
- 使用的API密钥前10位
- 使用的BaseURL
- 使用的模型名称
- API请求和响应详情

## 更新历史

- 2025-07-26: 添加环境变量支持，提取baseURL和prompt配置
