# Scripts Import Rule

此规则仅适用于 `scripts/**/*.mjs` 文件，规范脚本中的模块导入方式。

## 背景

scripts 目录下的脚本文件使用 ES Module (`.mjs`) 格式，通过 `tsx` 直接运行 TypeScript 源码。因此必须从 `src/` 目录导入，而非编译后的 `dist/` 目录。

## 规则

### 1. 禁止从 dist 目录导入

**错误示例：**
```javascript
// ❌ 错误：从 dist 目录导入
const { logService } = await import('../dist/services/logService.js');
const { Block } = await import('../dist/models/block.js');
```

**正确示例：**
```javascript
// ✅ 正确：从 src 目录导入 TypeScript 源文件
const { logService } = await import('../src/services/logService.ts');
const { Block } = await import('../src/models/block.ts');
```

### 2. 必须使用动态导入格式

由于当前脚本文件是 `.mjs` 格式，必须使用动态导入：

```javascript
// ✅ 正确：动态导入 src 目录下的 TypeScript 文件
const { logService } = await import('../src/services/logService.ts');
```

## 常见场景

### 导入 Service

```javascript
// ✅ 正确
const { logService } = await import('../src/services/logService.ts');

// ❌ 错误
const { logService } = await import('../dist/services/logService.js');
```

### 导入 Model

```javascript
// ✅ 正确
const logEntryModule = await import('../src/models/logEntry.ts');
const { LogCategory } = logEntryModule;

// ❌ 错误
const logEntryModule = await import('../dist/models/logEntry.js');
```

### 导入 Node.js 内置模块

Node.js 内置模块可以直接使用，不需要动态导入：

```javascript
// ✅ 正确：Node.js 内置模块
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
```

**例外**：如果在某些特殊情况下需要在运行时导入，使用标准动态导入格式：

```javascript
// ✅ 允许：标准动态导入 Node.js 模块
const crypto = await import('crypto');
const fs = await import('fs');
```

## 临时性说明

此规则是临时方案。未来计划：

1. 将 `.mjs` 脚本重构为 `.ts` 文件
2. 使用静态 `import` 语句替代动态导入
3. 移除 ESLint 中对 `no-restricted-syntax` 的豁免

重构后，scripts 目录下的代码将遵循主项目的 [import-syntax.rule.md](./import-syntax.rule.md) 规则。

## ESLint 配置

此规则通过 `no-restricted-imports` 实现：

```javascript
'no-restricted-imports': [
  'error',
  {
    patterns: [
      {
        group: ['**/dist/**', '../dist/**', './dist/**'],
        message: 'Scripts must import from src/ directory. Use: await import("../src/...")',
      },
    ],
  },
],
```

## 相关文件

- `eslint.config.mjs` - ESLint 配置
- `package.json` - npm scripts 配置（doctor, cleanup 等）
- `scripts/*.mjs` - 受影响的脚本文件
- [import-syntax.rule.md](./import-syntax.rule.md) - 主项目导入规则（未来 scripts 将遵循此规则）
