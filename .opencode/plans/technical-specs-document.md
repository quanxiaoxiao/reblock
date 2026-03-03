# 多语言重新实施的技术规范文档

> **注意**: 此文档已有英文版本，请参阅 [.opencode/plans/technical-specs-document.en.md](./technical-specs-document.en.md) 以获取最新和更完整的信息。
> 
> This document is now available in English. Please refer to [.opencode/plans/technical-specs-document.en.md](./technical-specs-document.en.md) for the most up-to-date and complete information.

## 1. 数据库模型规范和字段结构

### Block 集合实体结构

```javascript
Block: {
  _id: ObjectId,                 // MongoDB.ObjectId 类型；其他数据库的等效类型
  sha256: String,                // 原始内容的SHA-256哈希值
  size: Number,                  // 内容大小，以字节计
  linkCount: Number,             // 引用此块的有效资源数
  createdAt: Number,             // 创建时间戳（毫秒）
  updatedAt: Number,             // 更新时间戳（毫秒）
  isInvalid: Boolean,            // 软删除标志 - 默认为 false
  invalidatedAt: Number,         // 标记为无效的时间戳
}
```

**索引要求**：
- `{isInvalid: 1}`，带部分过滤器，用于有效块查询
- `{sha256: 1}`，满足条件的块具有唯一性约束 `isInvalid: false`
- `{sha256: 1}`，加速重复查找

### Resource 集合实体结构

```javascript
Resource: {
  _id: ObjectId,
  block: ObjectId,               // 引用包含数据的Block._id
  entry: ObjectId,               // 引用拥有此资源的Entry._id
  name: String,                  // 资源可选名称
  mime: String,                  // MIME类型
  description: String,           // 可选描述
  category: String,              // 可选分类
  createdAt: Number,
  updatedAt: Number,
  lastAccessedAt: Number,        // 最后下载时间戳
  isInvalid: Boolean,            // 软删除标志 - 默认为 false
  invalidatedAt: Number,         // 标记为无效的时间戳
  clientIp: String,              // 上传客户端IP地址
  userAgent: String,             // 上传请求的User-Agent字符串
  uploadDuration: Number,        // 上传持续时间（毫秒）
}
```

**索引要求**：
- `{block: 1}`, `{entry: 1}`, `{isInvalid: 1}` 各自单独索引用于连接操作
- `{entry: 1, isInvalid: 1}` 用于查询特定条目的资源
- `{isInvalid: 1, lastAccessedAt: 1}` 用于访问模式

### Entry 集合实体结构

```javascript
Entry: {
  _id: ObjectId,
  name: String,                  // 条目显示名称
  alias: String,                 // 在上传URL中使用的短标识符（活动条目间必须唯一）
  description: String,
  isDefault: Boolean,            // 默认条目标志 - 只允许一个活动默认项
  order: Number,                 // 显示顺序提示
  createdAt: Number,
  updatedAt: Number,
  isInvalid: Boolean,            // 软删除标志 - 默认为 false
  invalidatedAt: Number,         // 标记为无效的时间戳
  uploadConfig: {                // 可选上传限制设置
    maxFileSize: Number,         // 最大允许文件大小（字节）
    allowedMimeTypes: [String],  // 允许的MIME类型数组，支持通配符（如 image/*）
    readOnly: Boolean           // 如果为真则阻止进一步内容上传 - 默认为 false
  }
}
```

**索引要求**：
- `{isInvalid: 1}`, `{alias: 1}`, `{isDefault: 1}` 单独索引
- `{alias: 1}` 带部分唯一性约束（仅对非被软删除条目）
- `{isDefault: 1, isInvalid: 1}` 带唯一性约束，条件为 `isDefault: true AND isInvalid: false`

### ResourceHistory 集合实体结构

```javascript
ResourceHistory: {
  _id: ObjectId,
  resourceId: ObjectId,          // 引用受变更影响的Resource._id
  fromBlockId: ObjectId,         // 资源之前引用的块
  toBlockId: ObjectId,           // 变更后引用的新块
  action: String,                // 取值："swap", "rollback"
  changedAt: Number,             // 变更时间戳
  changedBy: String,             // 执行变更的用户/系统
  reason: String,                // 变更原因说明
  requestId: String,             // HTTP请求ID，用于关联
  rollbackable: Boolean,         // 此历史条目是否支持回滚
}
```

**索引要求**：
- `{resourceId: 1, changedAt: -1}` 查询资源的历史时间线
- `{toBlockId: 1, changedAt: -1}` 查看何时分配块给资源

## 2. 端点契约和请求响应规范

### 上传端点

#### POST `/upload/:alias`
按别名上传文件至条目，执行内容去重。

**参数**：
- `alias`（路径参数）：上传至的条目别名
- `name`（查询参数，可选）：覆盖元数据中的文件名

**请求体**：原始文件内容（二进制数据）或multipart表单数据

**响应**：带有已上传内容详情的资源对象

**执行逻辑**：
1. 通过 `:alias` 查找未被软删除 (`isInvalid != true`) 的条目
2. 计算输入文件的SHA-256哈希
3. 执行验证检查：
   - 文件大小 vs `uploadConfig.maxFileSize`
   - MIME类型检测 vs `uploadConfig.allowedMimeTypes`
   - 检查条目是否为 `uploadConfig.readOnly`
4. 尝试查找现有使用SHA-256的块（未被软删除）
5. 若找到，递增链接计数
6. 若未找到，用AES-ECB-CTR加密文件并保存至存储
7. 创建新资源记录，引用块ID和条目ID
8. 对 `sha256` 应用HMAC-SHA256，生成存储路径
9. 返回资源响应，包含完整元数据

#### GET `/resources/:id/history`
返回资源的块切换历史

**响应**：历史条目数组，包含块分配的时间线

## 3. 加密及内部存储详细信息

### 存储路径计算

为保护块存储并防止枚举攻击，采用基于HMAC的存储路径计算：

1. **从SHA-256哈希计算存储名**
   ```伪代码
   function generateStorageName(originalSha256) {
       // 从base64编码获取加密密钥
       const encryptionKey = decodeBase64FromEnv(ENCRYPTION_KEY);
       return hmac_sha256(encryptionKey, originalSha256);
   }
   ```

2. **生成文件系统路径**
   ```伪代码
   function getFilesystemPath(storageName) {
       const prefix1 = storageName.substring(0, 2);
       const secondChar = storageName.substring(2, 3);
       return `${prefix1}/${secondChar}${storageName}`;
   }
   ```
   
   示例：
   - 原始SHA-256: `abc...` (64字符十六进制)
   - 存储名 (HMAC): `d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50` 
   - 文件路径: `d9/8d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50`
   - 物理路径: `{STORAGE_BLOCK_DIR}/d9/8d9fe...` （与存储目录连接）

### 加密的初始化向量(IV)生成

为每个块，从MongoDB ObjectId计算初始化向量(IV)：

```伪代码
function deriveIVFromBlockId(blockId) {
    // 使用12字节ObjectId并补充4零字节
    const objectIdBytes = extractBytes(blockId);  // 获取原始BSON ObjectId字节
    return concat(objectIdBytes, zeros(4));      // 12 + 4 = 16 字节
}
```

这确保每个块获得可由ObjectId确定重现的独特IV。

### 加密过程

存储新内容块时：
1. 使用 `deriveIVFromBlockId()`（配合新建ObjectId）导出IV
2. 使用解码 `ENCRYPTION_KEY`（来自base64环境变量）和计算IV，采用AES-256-CTR模式
3. 依据 `getFilesystemPath(generateStorageName(...))` 计算的存储路径保存密文至文件系统

### 解密过程

下载时返回内容：
1. 从资源关联的块记录读取SHA-256
2. 使用 `getFilesystemPath(generateStorageName(sha256))` 重现计算存储路径
3. 再次使用块的`_id` ObjectId导出IV
4. 使用环境密钥和计算IV通过AES-256-CTR解密数据

## 4. 状态和生命周期管理规则

### 软删除行为

而非从数据库移除记录，系统使用`isInvalid`字段软删除模式：

- `POST /entries`、`POST /resources`、`UPLOAD`: 设 `isInvalid` 为 `false`
- `DELETE /entries/:id`、`DELETE /resources/:id`: 设 `isInvalid` 为 `true`，同时设置 `invalidatedAt` 时间戳

查询应以 `isInvalid: { $ne: true }` 或 `isInvalid != true` 过滤，排除软删除项。

### 资源-块链接计数管理

系统维护引用计数，以安全清除无用块：

- 新资源创建引用块时，递增 `Block.linkCount` 1
- 资源软删除引用块时，递减 `Block.linkCount` 1
- `linkCount === 0` 与 `isInvalid === false` 的块视为"孤立"
- 定期清理进程软删除孤立块并移除关联文件

这确保各资源共享块不被提前清理，文件在最终引用消失时才被移除。

## 5. 事务处理考虑

某些操作如块去重使用原子操作确保一致性：

- 使用数据库级别的原子递增/递减，用于链接计数管理
- 事务支持有限环境，设计操作保持幂等或使用独特约束与冲突错误作为一致性的机制
- 唯一SHA-256约束的块创建在上传期间充任去重同步点

## 6. 环境配置

系统运行所需的环境变量：

| 变量 | 用途 | 示例 |
|------|------|------|
| `ENCRYPTION_KEY` | Base64编码的32字节AES密钥 | `MyU2FkZWRJYnJ0b24tQmxvY2tvQ2FyaW4=/=` |
| `STORAGE_BLOCK_DIR` | 存储加密块文件的目录 | `./storage/blocks` |
| `STORAGE_TEMP_DIR` | 临时上传文件的目录 | `./storage/temp` |
| `MONGO_URI` | MongoDB连接字符串 | `mongodb://localhost:27017/reblock` |
| `LOG_TTL_DAYS` | 保留日志的天数 | `90` |

此指南作为跨编程语言的Reblock服务实现基础，于API与业务逻辑层保持兼容。

For the complete and updated information, please see the English version: [.opencode/plans/technical-specs-document.en.md](./technical-specs-document.en.md)