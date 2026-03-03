# 安全加密规范文档

> **注意**: 此文档已有英文版本，请参阅 [.opencode/plans/security-encryption-spec.en.md](./security-encryption-spec.en.md) 以获取最新和更完整的信息。
> 
> This document is now available in English. Please refer to [.opencode/plans/security-encryption-spec.en.md](./security-encryption-spec.en.md) for the most up-to-date and complete information.

## 1. 加密算法规范

### AES - 256 - CTR 模式加密

所有块数据都使用AES - 256 - CTR模式进行加密存储：

**加密模式**：AES - 256 - CTR（计数器模式）
- 对称加密算法
- CTR模式提供流加密特性，支持随机访问（对范围请求很重要）
- 密钥长度为256位（32字节）

**加密流程**：
1. 从环境变量读取基础加密密钥（base64编码的32字节字符串）
2. 对每个块生成唯一的初始化向量IV（16字节）
3. 使用AES - 256 - CTR模式加密原始文件数据
4. 将结果写入对应的安全存储位置

**密钥格式**：从环境变量ENCRYPTION_KEY读取的是base64编码的32字节密钥，使用时解码成原始32字节序列。

**初始化向量 - 生成规则**：
- 从关联的MongoDB ObjectId（12字节）生成16字节IV
- 追加4个零字节到12字节ObjectId末尾，形成16字节IV
- 保证每个块都有唯一的、可重现的IV

**实现示例 - Python风格**：
```pseudo
def derive_iv_from_object_id(object_id):
    object_id_bytes = convert_to_bytes(object_id)  # 12字节BSON ObjectID
    assert len(object_id_bytes) == 12
    return object_id_bytes + bytes(4)  # 补齐到16字节
```

## 2. HMAC - SHA256 存储路径保护

为防止外部访问者预测文件存储路径，使用HMAC保护存储路径生成：

**核心算法**：HMAC - SHA256
- 用于生成安全存储文件名
- 防止路径枚举行为
- 必须知道正确加密密钥才能构建有效路径

**安全存储路径生成过程**：
1. 取内容的SHA256哈希值（64字符16进制小写）
2. 以环境加密密钥为密钥，对上述SHA256哈希应用HMAC - SHA256
3. 得到的输出作为安全存储名（64字符16进制小写）
4. 从存储名构造文件目录路径（前2字符为第一级，第3字符加上全名为第二级）

**存储路径实现 - 伪代码**：
```pseudo
def generate_storage_name(sha256_hash):
    encryption_key = base64_decode(env.ENCRYPTION_KEY)
    return hmac_sha256(encryption_key, sha256_hash)

def get_file_path(storage_name):
    prefix1 = storage_name[0:2]          # 前两个字符
    second_char = storage_name[2:3]      # 第三个字符
    return f"{prefix1}/{second_char}{storage_name}"
```

**路径构造示例**：
- 原始SHA256: `a1b2c3d4e5f6...` (64字符)
- 安全存储名: `d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50`
- 构建路径: `d9/8d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50`
- 完整路径: `$STORAGE_BLOCK_DIR/d9/8d9fe03...`

## 3. 安全密钥生命周期管理

**运行时验证**：
- 启动时检查ENCRYPTION_KEY存在且长度正确（32解码后字节）
- 如果密钥不存在或不正确，抛出错误并终止服务启动
- 不能使用默认密钥，因为会影响安全性

**ENV配置要求**：
- 必须使用base64编码
- 32字节长度（编码后字符串约44字符加上可能的填充）
- 存储于安全环境变量而非代码中

**安全验证流程**：
```pseudo
def check_encryption_key():
    if env.ENCRYPTION_KEY is None:
        raise Exception("ENCRYPTION_KEY not configured")
    
    key_bytes = base64_decode(env.ENCRYPTION_KEY)
    if len(key_bytes) != 32:
        raise Exception(f"Invalid encryption key length: {len(key_bytes)} bytes, expected 32 bytes")
    
    return key_bytes
```

## 4. 支持范围请求的加密处理

**AES - 256 - CTR 特性**：
- CTR模式支持随机访问而不必解密整个文件
- 可计算偏移到正确计数器值然后开始解密

**偏移解密函数要求**：
- `create_decrypt_stream_with_offset(iv, offset)` 函数需正确调整CTR计数器
- 正确处理跨块的偏移：AES块为16字节，计算偏移应跳过的块数
- 处理首个加密块的部分解密：只丢弃开始处的特定数量字节

**实现建议**：
```pseudo
def create_decryption_with_offset(iv, start_offset_bytes):
    # 每个AES块16字节，计算起始块索引
    block_size = 16
    starting_block_index = start_offset_bytes // block_size
    
    # 修改IV的后4字节，加入块索引
    modified_iv = list(iv)
    block_index_bytes = encode_uint32_be(starting_block_index)
    
    # 简化：将块索引与原有计数器值进行XOR（实际算法需更精确）
    for i in range(4):
        modified_iv[12 + i] ^= block_index_bytes[i]
    
    cipher = create_aes_ctr_cipher(key, modified_iv)
    
    # 初始化时丢弃第一个加密块的前部指定字节数
    skip_bytes_count = start_offset_bytes % block_size
    
    return DecriptionStream(cipher, skip_initial_bytes=skip_bytes_count)
```

## 5. 加密密钥轮换考虑

**当前版本假定单一固定密钥（简化实现）**：
- 未实现密钥轮换
- 后续扩展可能增加键值与加密版本到存储系统中

**升级路径考虑**：
- 每个块可能需要额外字段记录加密版本
- 可维持多个历史加密密钥，用于解密旧数据
- 新数据用最新密钥加密（仅加密）

## 6. 安全审计与日志记录

**加密错误的记录处理**：
- 记录加密失败事件，但不在日志中暴露密钥
- 日志包含文件SHA256、块ID等可检索信息
- 不记录加密或解密过程的原始数据

**审计建议**：
- 所有使用加密/解密操作的API调用应记录到日志服务
- 敏感操作（如修改加密配置）需额外认证
- 文件访问日志中避免直接泄露原始路径信息

## 7. 验证测试向量

为确保不同语言实现的一致性，请使用标准测试向量验证：

**示例输入**：
- 明文: "Hello World"
- 32字节密钥 (base64): "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE="
- ObjectId: "507f1f77bcf86cd799439011"

**预期输出**：
- 解码密钥字节: 16进制表示的字节串，内容全为0x31 (32个字节)
- 生成IV: ObjectID字节加上4个00
- 加密"Hello World": 具体加密后的字节序列（可通过实现验证）

此文档应确保实现的加密组件与其他语言版本具有互操作性和安全性要求的一致性。

For the complete and updated information, please see the English version: [.opencode/plans/security-encryption-spec.en.md](./security-encryption-spec.en.md)