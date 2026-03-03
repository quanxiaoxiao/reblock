# Opencode 示例与文档规范标准

## 概述

本文档定义了 Reblock 项目中所有规范文档的编写标准，旨在确保文档的一致性、可读性和通用性。所有 `.opencode/rules/*.rule.md` 文件都应该遵循这些规范。

## 1. 通用文档结构标准

### 1.1 基本文档模板
每个规则文档应包含以下部分：
- 标题 (# Rule Name)
- 概述 (Brief explanation of what this rule defines)
- 核心内容区域 (使用标准格式)
- 实现检查列表 (Implementation checklist section)

### 1.2 内容组织原则
- 按逻辑主题将内容分解为清晰的小节
- 每个部分标题后包含必要的解释说明
- 用横线 (---) 分隔关键概念区域

## 2. 代码示例标准

### 2.1 推荐使用场景

#### 2.1.1 HTTP API 示例（推荐：使用 curl）
API 请求示例应始终使用 curl 命令而非特定编程语言的 HTTP 库：

✅ **推荐格式**：
```bash
curl -X POST "http://localhost:3000/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Documents"
  }'
```

❌ **不推荐格式**：
```javascript
// JavaScript fetch
fetch('/entries', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({...})
})

// 或 axios
axios.post('/entries', {...})
```

#### 2.1.2 通用数据结构示例（推荐：JSON 结构）

使用纯 JSON 语法定义数据结构，避免指定实现语言：

✅ **推荐格式**：
```json
{
  "status": "resolved",
  "changedAt": 1772241200000,
  "changedBy": "cleanup-script",
  "note": "Soft deleted via cleanup script"
}
```

❌ **不推荐格式**：
```javascript
// JavaScript 对象字面量
{
  status: 'resolved',
  changedAt: 1772241200000,
  changedBy: 'cleanup-script',
  note: 'Soft deleted via cleanup script'
}
```

#### 2.1.3 伪代码/算法示例（推荐：通用编程概念）

使用与特定语言无关的伪代码：

✅ **推荐格式**：
```
CLIENT PROCEDURE uploadFile(alias, file):
    INPUT: alias (string), file (binary/object)
    OUTPUT: upload response or appropriate error
    
    SEND HTTP POST REQUEST to "/upload/" + alias with file content
    STORE response
    
    IF response status is 2xx:
        PARSE response as JSON
        RETURN parsed response
    END IF
    
    PARSE error response as JSON
    RESPONSE STATUS CODE determines error handling...
    END CONDITIONAL
END PROCEDURE
```

❌ **不推荐格式**：
```
async function uploadFile(alias, file):  # JavaScript 风格
    response = await POST(...)

# 或
func uploadFile(alias string, file []byte)  # Go 风格
```

### 2.2 不应该使用的语法

- 避免任何特定编程语言语法，如 `async/await`, `Promise`, `->`, `=>`, `:` (对象声明), `.` (方法调用)
- 避免具体类型的声明，如 `let`, `const`, `var`, `int`, `string`
- 避免包含具体库/框架名称或特定包导入语句

## 3. API 请求示例标准（CURL 优先）

### 3.1 HTTP 请求/响应示例格式
提供完整的请求/响应示例，按如下格式组织：

```
POST /entries
Content-Type: application/json

{
  "name": "My Documents"
}

HTTP 201 Created
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "My Documents"
}
```

### 3.2 cURL 示例规范
当提供命令行示例时：
- 始终从 `curl -X <METHOD> "URL"` 开始
- 将长命令分为多行，使用 `\` 换行符连接
- 在 `Content-Type` 头前使用 `-H`
- 将请求体使用 `-d` 参数，用单引号包装 JSON
- 换行缩进应与命令开头对齐

### 3.3 参数说明表格
对于需要参数说明的端点，使用以下表格格式：

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name      | string | Yes      | Display name |

## 4. 数据结构定义标准

### 4.1 通用数据结构标记
数据结构定义使用以下格式：

```
DATA STRUCTURE StructureName:
- property1: TypeName (Description)
- property2: Optional TypeName (Description)
- property3: Array[TypeName] (Description of array items)
```

### 4.2 接口/实体定义
对于接口定义使用 TypeScript 风格，保持通用性：

```typescript
interface EntityName {
  _id: string;
  property: TypeName;  // Description
}
```

## 5. 状态与流程表示标准

### 5.1 状态转换图
使用 ASCII 风格绘制状态转换图：

```
                    ┌─────────────┐
                    │    open     │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ┌─ ack ─▶ ┌─────────────┐   ┌─────────────┐
         │         │acknowledged │   │  resolved   │
         ▼         └──────┬──────┘   └─────────────┘
  ┌─────────────┐         │
  │   ignored   │ ────────► resolved
  └─────────────┘        ┌─────────────┐
                         │  (final)    │
                         └─────────────┘
```

### 5.2 状态转移矩阵
使用表格格式定义允许的转移：

| Source \ Target | `open` | `acknowledged` | `resolved` | `ignored` |
|-----------------|--------|----------------|------------|-----------|
| `open`          | -      | ✅             | ✅         | ✅        |
| `acknowledged`  | ❌     | -              | ✅         | ✅        |

### 5.3 决策流程描述
对于业务流程，使用步骤编号或条件逻辑图。

## 6. 表格与列表标准

### 6.1 二维关系表格
对于显示映射/对应关系的表格：

| Code | HTTP Status | Description |
|------|-------------|-------------|
| NOT_FOUND | 404 | Resource not found |

### 6.2 单列表格
仅列出元素时，使用简洁格式：

- Item 1
- Item 2
- Item 3

### 6.3 功能对比表格
当需要对比特性时，使用特征列为第一列：

| Feature | Current Behavior | New Requirement |
|---------|------------------|------------------|
| Auth | Basic | JWT |

## 7. 错误处理示例标准

### 7.1 标准错误格式
统一的错误响应格式定义：

```json
{
  "error": "Human-readable message",
  "code": "PROGRAMMATIC_ERROR_CODE" 
}
```

### 7.2 特定错误类型格式
当需要提供详细错误信息时（例如验证错误）：

```json
{
  "error": "Validation error",
  "details": [
    {
      "field": "name",
      "message": "String must contain at least 1 character"
    }
  ]
}
```

## 8. 注释与文档内引用

### 8.1 行内注释
使用标准 Markdown 注释格式，或在行尾添加简短说明。
- 代码块：避免注释特定语言的注释符
- 表格：必要时使用描述性文本解释复杂字段

### 8.2 跨文档引用
- 引用其他规则文件时，使用文件名
- 引用其他服务或方法时，描述性提及而非具体语言实现

## 9. 整体布局建议

### 9.1 部分组织结构
1. 概念介绍
2. 技术细节 
3. 实际示例
4. 行为矩阵/流程
5. 实现注意事项
6. 验证/测试要点

### 9.2 阅读流畅性
- 每节应逐步深入，先易后难
- 横线分隔明显不同类型的信息
- 图表紧随其文字说明
- 实现检查表放在最末尾

## 10. 不同类型的文档内容适应

### 10.1 规则类文档
- 定义明确的行为边界
- 用清晰的禁止/允许标签区分
- 包含触发条件和预期行为

### 10.2 流程类文档  
- 时间顺序步骤
- 决策点标记
- 可选执行路径

### 10.3 配置/架构类文档
- 批注组件间关系
- 显示数据流向
- 分层结构关系