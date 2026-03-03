# Import Syntax Rule

所有代码必须使用 ES Module 静态导入语法，禁止使用 CommonJS 和动态导入。

## 规则

1. **禁止使用 `require()`** - 这是 CommonJS 语法，本项目使用 ES Module
2. **禁止使用 `await import()`** - 动态导入只在特殊场景允许，代码中应使用静态导入
3. **所有导入必须放在文件顶部** - 使用标准的 ES Module import 语法

## 正确示例

```typescript
// ✅ 正确：静态导入在文件顶部
import { logService } from '../services/logService';
import { Block } from '../models/block';
import type { IBlock } from '../models/block';

export async function processBlock(id: string) {
  const block = await Block.findById(id);
  await logService.logIssue({...});
}
```

## 错误示例

```typescript
// ❌ 错误：使用 require()
const fs = require('fs');

// ❌ 错误：使用动态导入
async function init() {
  const { logService } = await import('../services/logService');
}

// ❌ 错误：条件导入（也是动态导入）
if (condition) {
  const module = await import('./module');
}
```

## 例外情况

以下情况可以在 ESLint 配置中单独禁用此规则：

1. 配置文件加载（如加载 `.env` 文件前的早期阶段）
2. 测试文件中的动态 mock
3. 构建工具脚本

**注意**：脚本文件（scripts/*.mjs）正在重构中，后续将改为 TypeScript 并使用静态导入。

## 为什么这样设计

1. **一致性**：统一使用 ES Module 语法，避免 CommonJS 和 ES Module 混用
2. **可分析性**：静态导入使依赖关系清晰，便于工具分析和 tree-shaking
3. **类型安全**：TypeScript 对静态导入提供更好的类型推断
4. **代码规范**：导入放在文件顶部是标准做法，提高可读性

## ESLint 配置

此规则通过 `no-restricted-syntax` 实现：

```javascript
'no-restricted-syntax': [
  'error',
  {
    selector: "CallExpression[callee.name='require']",
    message: 'Use ES module import syntax instead of require()',
  },
  {
    selector: "ImportExpression",
    message: 'Use static import statements at the top of the file instead of dynamic import()',
  },
],
```

## 相关文件

- `eslint.config.mjs` - ESLint 配置文件
- `scripts/*.mjs` - 待重构的脚本文件（当前暂时禁用此规则）
