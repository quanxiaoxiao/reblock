# Console Output Style Compliance Analysis Report

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total Scripts Analyzed** | 27 |
| **Compliant Scripts** | 3 |
| **Partially Compliant** | 9 |
| **Non-Compliant** | 15 |

---

## Detailed Analysis by Script

### ✅ COMPLIANT (3 scripts)

#### 1. `scripts/maintenance/status.mjs`
**Compliance Score: 95%**

**Strengths:**
- ✓ Proper color definitions (green, yellow, red, cyan, gray)
- ✓ Standard status indicators: ✔, ✖, !
- ✓ Header pattern with bold title, dim context, divider
- ✓ Section pattern with bold titles and dim underlines
- ✓ Info line pattern: 2-space indent, dim labels (16 chars), colored values
- ✓ Percentage color coding by threshold (<70% green, 70-90% yellow, >90% red)
- ✓ Duration formatting: `5d 3h`, `45m 30s` format
- ✓ File size formatting with proper decimals

**Minor Issues:**
- Uses Chinese characters in section titles (容器, 系统, Docker, 版本, 网络) - acceptable for domain context
- Line 418: `user ${status.system.cpu.user}` should use dim for labels

**Example of good patterns:**
```javascript
// Lines 55-59: Perfect info line pattern
function logInfo(label, value, hint = '') {
  const lbl = `${c.dim}${label.padEnd(16)}${c.reset}`;
  const hintStr = hint ? `  ${c.dim}${hint}${c.reset}` : '';
  console.log(`  ${lbl}${value}${hintStr}`);
}

// Lines 44-48: Proper header pattern
function logBanner(title, host, subtitle = '') {
  console.log(`\n${c.bold}${c.white}${title}${c.reset}  ${c.dim}${host}${c.reset}`);
  if (subtitle) console.log(`${c.dim}${subtitle}${c.reset}`);
  console.log(DIVIDER);
}
```

---

#### 2. `scripts/maintenance/rollback.mjs`
**Compliance Score: 90%**

**Strengths:**
- ✓ Comprehensive color abstraction with terminal detection
- ✓ Uses standard status indicators: ✔, ✖, ⚠ (acceptable variant)
- ✓ Spinner implementation with proper frames (⠋ ⠙ ⠹...)
- ✓ Progress indicators with dim styling
- ✓ Good use of bold for headers and emphasis
- ✓ Info lines with dim labels and colored values

**Issues:**
- Lines 98-99: Uses `⚠` (warning triangle) instead of `!` - acceptable but not standard
- Lines 157, 176, 187: Uses emoji (🔄, 🎉, 💥) in banners - violates "no emoji" rule
- Custom box drawing characters extend beyond standard patterns

**Good patterns:**
```javascript
// Lines 67-100: Excellent spinner implementation
class Spinner {
  constructor(text) {
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    // ...
  }
}

// Lines 129-143: Proper status output helpers
function printOk(message) {
  print(`  ${c.green}✔${c.reset}  ${c.white}${message}${c.reset}`);
}
```

---

#### 3. `scripts/maintenance/deploy.mjs`
**Compliance Score: 88%**

**Strengths:**
- ✓ Standard color palette
- ✓ Uses ✔, ✖, ⚠ indicators correctly
- ✓ Bold headers and step labels
- ✓ Step counter with dim styling
- ✓ Info lines with gray labels
- ✓ Success/fail banners with box drawing

**Issues:**
- Lines 63, 109: Uses emoji (🚀, 🎉, 💥) in banners
- Lines 76-78: 3-space indent instead of 2-space standard
- Line 98-103: `logCheckRow` uses `─` (neutral) instead of color-coded indicators

---

### ⚠️ PARTIALLY COMPLIANT (9 scripts)

#### 4. `scripts/maintenance/doctor.mjs`
**Compliance Score: 70%**

**Issues:**
- **CRITICAL:** Lines 316-317, 322-323, 337, 345: Uses emoji (🔍, 📊, ❌, 💡) instead of ASCII indicators
- **CRITICAL:** Lines 359-361: Uses colored circles (🔴🟡🔵) instead of standard status indicators
- Line 159: Uses ✓ instead of ✔ (minor inconsistency)
- Line 437: Uses Chinese success message without indicator
- Good: Proper color usage for severity levels
- Good: Structured report format with dividers

**Non-compliant example:**
```javascript
// Line 316 - NON-COMPLIANT (emoji)
console.log(`${colors.cyan}🔍 Reblock Doctor - 健康检查报告${colors.reset}`);

// Lines 359-361 - NON-COMPLIANT (emoji circles instead of standard indicators)
const severityIcon = issue.severity === Severity.CRITICAL ? '🔴' :
                    issue.severity === Severity.WARNING ? '🟡' : '🔵';
```

---

#### 5. `scripts/maintenance/cleanup.mjs`
**Compliance Score: 75%**

**Issues:**
- Lines 246, 259, 289, 333, 463: Uses emoji (📝, ✅, ⚠️, 💾, ✓, ✗)
- Line 136: Uses ✓ instead of ✔
- Good: Proper info line formatting
- Good: Color-coded status messages

---

#### 6. `scripts/maintenance/cleanup-all.mjs`
**Compliance Score: 65%**

**Issues:**
- Line 156: Emoji (🧹) in header
- Lines 162, 223, 233, 239, 243, 247, 253: Emoji (✅, ❌, ℹ️, 🗑️)
- No structured section headers
- No info line pattern
- Simple text output without proper styling

---

#### 7. `scripts/maintenance/logs-analyze.mjs`
**Compliance Score: 72%**

**Issues:**
- Lines 186, 237, 247: Emoji (📊, ⚠️, 🔴)
- No section headers with underlines
- Good: Color usage for levels and status
- Good: Structured output format

---

#### 8. `scripts/resource-mgmt/resource-report.mjs`
**Compliance Score: 68%**

**Issues:**
- **EXTENSIVE EMOJI USAGE:** Lines 360, 363, 371, 379, 392, 402, 423, 440, 454: Uses (📊, 🔍, 📁, ⏱️, 📦, ⚠️, 🔍, 📜, 📈)
- Lines 92-95: Uses emoji-based helpers (✓, ✗, ⚠)
- Line 403: Uses ✗ for deleted status instead of proper indicator
- Good: Section headers with underlines
- Good: Color-coded health status

---

#### 9. `scripts/resource-mgmt/resource-corrupt.mjs`
**Compliance Score: 65%**

**Issues:**
- Lines 136, 140, 144, 152, 490, 491, 499, 555, 557, 571, 573, 587, 603: Emoji (✓, ✗, ⚠, 🔧, 💥)
- Lines 490-491: Multiple emoji in header
- Good: Section pattern with underlines
- Good: Terminal color abstraction

---

#### 10. `scripts/migration/migrate-from-json.mjs`
**Compliance Score: 60%**

**Issues:**
- **EXTENSIVE EMOJI USAGE:** Lines 92-95, 203, 211, 328, 329, 330, 334, 376, 377, 378, 379, 442, 443, 444, 458, 459, 488: Uses (❌, ✅, ⚠️, 🔍, 📂, 🔢, ⏭️, 📉, 📷, 🚀)
- Line 88-95: Emoji-based log helpers
- Custom timestamp format acceptable but not standard
- Good: Structured report at end

---

#### 11. `scripts/migration/migrate.mjs`
**Compliance Score: 62%**

**Issues:**
- Lines 88-101: Emoji-based log helpers (❌, ✅, ⚠️, ℹ️)
- Lines 111, 137, 187, 354, 384, 388: Uses emoji (🔍, 📥, ✅, ⏭️, ❌, 📊)
- Good: Section dividers with =
- Good: Color usage for status

---

#### 12. `scripts/migration/restore-cascade-delete.mjs`
**Compliance Score: 70%**

**Issues:**
- Lines 84, 310, 356, 357, 358, 362, 363, 372, 373, 376: Emoji (✓, ✗, ⚠️, ✅)
- Line 129-131: Section uses `─` underline (good) but without bold title
- Good: Color-coded status output
- Good: Summary formatting

---

#### 13. `scripts/testing/test-logging.mjs`
**Compliance Score: 55%**

**Issues:**
- **EXTENSIVE EMOJI USAGE:** Lines 75-82, 386-389, 397, 425, 439: Uses (ℹ, ✓, ✗, ⚠, ▶, →, 🧪)
- Lines 386-389: Header with emoji border
- Lines 75-82: Custom log object with emoji prefixes
- Good: Section pattern
- Good: Color definitions

---

#### 14. `scripts/testing/resource-test-suite.mjs`
**Compliance Score: 58%**

**Issues:**
- Lines 111-127: Emoji-based helpers (✓, ✗, ⚠)
- Lines 128-131: Section pattern but with emoji border
- Lines 402, 475, 476, 512, 514, 518, 524: Uses emoji (🧪, 📊, 🔧, ✅, ❌)
- Good: Structured output

---

#### 15. `scripts/testing/e2e-test.mjs`
**Compliance Score: 52%**

**Issues:**
- **EXTENSIVE EMOJI USAGE:** Throughout the file
- Lines 96-112: Custom log helpers with emoji
- Lines 145, 239, 312, 354, 381, 422, 444, 453, 470, 582, 609, 683, 711, 757: Uses (🎲, ✅, ❌, ⚠️, ℹ️, 🔍, 📥, 📦, 🗑️, 🧪)
- Line 757: Header with emoji
- Custom status tracking without standard indicators

---

### ❌ NON-COMPLIANT (12 scripts)

#### 16. `scripts/resource-mgmt/update-entry.mjs`
**Compliance Score: 45%**

**Issues:**
- **NO COLOR ABSTRACTION:** Direct use of emoji (❌, ✅, ℹ️) in lines 68-78
- Lines 63-78: Log functions use emoji instead of indicators
- Lines 133-135, 154, 155, 169, 173, 211, 225, 284, 286, 287, 288, 290, 293, 294, 303, 314, 330, 331: Uses emoji
- No color definitions at all
- No structured section headers
- No info line pattern

---

#### 17. `scripts/resource-mgmt/create-entry.mjs`
**Compliance Score: 50%**

**Issues:**
- Lines 32-41: Color definitions present but minimal
- Line 64: Uses ✗ instead of ✖
- Lines 133, 187, 198, 239, 240, 241, 266-275: Uses emoji (✓, ✗) extensively
- Lines 239-241: Error messages with emoji
- No section headers
- No info line pattern

---

#### 18. `scripts/error-handling/errors-resolve.mjs`
**Compliance Score: 35%**

**Issues:**
- **NO COLOR USAGE AT ALL:** No ANSI color codes
- **NO STATUS INDICATORS:** No ✔, ✖, ! symbols
- Plain text output only
- No headers, sections, or structured formatting
- Lines 111-113: Simple console.log output

---

#### 19. `scripts/error-handling/errors-repro.mjs`
**Compliance Score: 40%**

**Issues:**
- **NO COLOR USAGE:** No ANSI color codes
- **NO STATUS INDICATORS:** No symbols used
- Lines 247, 260: Plain text output
- No structured formatting
- Simple console.log for all output

---

#### 20. `scripts/error-handling/errors-fetch.mjs`
**Compliance Score: 38%**

**Issues:**
- **NO COLOR USAGE:** No ANSI color codes
- Lines 97, 131, 149, 163, 173, 189: Plain text console output
- No status indicators
- No structured formatting

---

#### 21. `scripts/migration/import-imgs.mjs`
**Compliance Score: 48%**

**Issues:**
- Lines 168-172: Uses emoji (✅, ❌, ⚠️) in formatBytes helper
- Lines 200, 209, 219, 220, 225, 229, 230, 238, 239, 245, 252, 253, 259, 261, 266, 270, 329, 347, 361, 369, 371, 376, 378, 381, 390: Uses emoji (📁, ✅, ⚠️, ❌, 📂, 📉)
- Good: Some color usage for status
- Good: Step-by-step structure

---

#### 22. `scripts/testing/test-workflow.mjs`
**Compliance Score: 42%**

**Issues:**
- **MINIMAL COLOR USAGE:** Only basic colors defined
- Lines 43, 52: Color definitions but limited usage
- Lines 112, 113, 120, 126, 132, 138, 148, 156, 160: Uses emoji (🧪, 📍, ✅, ❌, 📊)
- No structured section headers
- No info line pattern

---

#### 23. `scripts/testing/stress-test.mjs`
**Compliance Score: 46%**

**Issues:**
- Lines 83-87: Basic color definitions
- Lines 158, 172, 219, 239, 251, 252, 268, 273, 287: Uses emoji (🚀, ✅, ❌, 📁, 📤, 🔍, 🔐, 🗑️, 📊)
- No section headers
- No info line pattern
- Simple console.log for most output

---

#### 24. `scripts/testing/test-mp4.mjs`
**Compliance Score: 48%**

**Issues:**
- Lines 60-66: Good log object with colors
- Lines 119, 129, 136, 145, 161, 170, 195, 221, 269, 276, 295, 300, 370, 382, 390, 429, 430, 441: Uses emoji (▶, ✓, ✗, ⚠, ℹ, 🎬)
- Lines 370-371: Header with emoji
- Good: Section headers with ▶
- Good: Color usage in log object

---

#### 25. `scripts/testing/test-mp4-browser.mjs`
**Compliance Score: 44%**

**Issues:**
- Lines 66-73: Good log object with colors
- Lines 420, 430-433, 438, 455, 460, 480, 488, 498, 509, 529, 542, 549, 556, 560: Uses emoji (🌐, ✅, ❌, ⚠️, ℹ️, ▶, 🔧, 📋)
- Lines 386-389: Header with emoji border
- MCP integration code is placeholder
- Good: Section pattern

---

#### 26. `scripts/utils/run-until-clean.sh`
**Compliance Score: 50%**

**Issues:**
- Shell script (not JS), but still uses emoji
- Lines 9, 10, 16, 25, 30, 32, 36, 43: Uses emoji (🔄, 📝, ✅, ⚠️, ❌)
- No color codes used
- Simple text output

---

## Common Issues Found

### 1. **Emoji Usage (Critical - 22 scripts affected)**
**Rule Violated:** "Avoid emojis. Use ASCII-safe symbols for maximum terminal compatibility."

**Most Common Violations:**
- ✅ (green checkmark) instead of ✔
- ❌ (red X) instead of ✖
- ⚠️ (warning triangle) instead of !
- 📝, 📊, 🔍, 📁, and other decorative emojis

**Impact:** May not render correctly in all terminals

**Recommended Fix:**
```javascript
// NON-COMPLIANT
console.log(`${colors.green}✅ Success${colors.reset}`);
console.log(`${colors.red}❌ Error${colors.reset}`);

// COMPLIANT
console.log(`${colors.green}✔${colors.reset} Success`);
console.log(`${colors.red}✖${colors.reset} Error`);
```

---

### 2. **No Color Abstraction (5 scripts affected)**
**Rule Violated:** "Provide symbolic color identifiers (e.g., SUCCESS, WARNING, ERROR)"

**Affected Scripts:**
- errors-resolve.mjs
- errors-repro.mjs
- errors-fetch.mjs
- update-entry.mjs
- run-until-clean.sh

**Recommended Fix:**
```javascript
// Add color definitions
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};
```

---

### 3. **Inconsistent Status Indicators (15 scripts affected)**
**Rule Violated:** Standard indicator usage

**Common Problems:**
- Mixing ✓ and ✔
- Mixing ! and ⚠️
- Using emojis instead of ASCII symbols

**Standard to Follow:**
| Status | Symbol | Color |
|--------|--------|-------|
| Success | ✔ | Green |
| Error | ✖ | Red |
| Warning | ! | Yellow |
| Progress | → | Cyan |
| Bullet | • | Neutral |

---

### 4. **Missing Layout Patterns (12 scripts affected)**
**Rule Violated:** "Use header, section, info line patterns"

**Common Problems:**
- No header with title/context/timestamp
- No section headers with underlines
- No info line pattern (2-space indent, dim labels)

**Recommended Fix:**
```javascript
// Header pattern
console.log(`\n${c.bold}${title}${c.reset}  ${c.dim}${context}${c.reset}`);
console.log(`${c.dim}${'─'.repeat(52)}${c.reset}`);

// Section pattern
console.log(`\n${c.bold}${title}${c.reset}`);
console.log(`${c.dim}${'─'.repeat(title.length)}${c.reset}`);

// Info line pattern
console.log(`  ${c.dim}${label.padEnd(16)}${c.reset}${value}`);
```

---

## Recommendations for Fixes

### Priority 1: Fix Emoji Usage (All scripts except status.mjs, rollback.mjs, deploy.mjs)

Create a shared style utility file:

```javascript
// scripts/utils/style.mjs
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

export const icons = {
  success: '✔',
  error: '✖',
  warning: '!',
  arrow: '→',
  bullet: '•',
  ellipsis: '…',
};

export function logInfo(label, value, hint = '') {
  const lbl = `${c.dim}${label.padEnd(16)}${c.reset}`;
  const hintStr = hint ? `  ${c.dim}${hint}${c.reset}` : '';
  console.log(`  ${lbl}${value}${hintStr}`);
}

export function logSection(title) {
  console.log(`\n${c.bold}${title}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(title.replace(/[\u4e00-\u9fa5]/g, 'xx').length)}${c.reset}`);
}

export function logSuccess(message) {
  console.log(`  ${c.green}${icons.success}${c.reset} ${message}`);
}

export function logError(message) {
  console.log(`\n  ${c.red}${icons.error}${c.reset} ${message}`);
}

export function logWarning(message) {
  console.log(`  ${c.yellow}${icons.warning}${c.reset} ${message}`);
}
```

### Priority 2: Add Color Abstraction (errors-*.mjs scripts)

Add the color constants at the top of each script.

### Priority 3: Standardize Layout Patterns

Refactor scripts to use:
1. Header with title, context, divider
2. Sections with bold titles and dim underlines
3. Info lines with 2-space indent and dim labels

---

## Best Practice Examples

### Example 1: Header Pattern (from status.mjs)
```javascript
const W = 52;
const DIVIDER = `${c.dim}${'─'.repeat(W)}${c.reset}`;

function logBanner(title, host, subtitle = '') {
  console.log(`\n${c.bold}${c.white}${title}${c.reset}  ${c.dim}${host}${c.reset}`);
  if (subtitle) console.log(`${c.dim}${subtitle}${c.reset}`);
  console.log(DIVIDER);
}

// Usage:
logBanner('Reblock Server Status', `${config.user}@${config.host}:${config.port}`, now);
```

### Example 2: Section Pattern (from rollback.mjs)
```javascript
function printSection(title) {
  console.log(`\n${c.bold}${title}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(title.replace(/[\u4e00-\u9fa5]/g, 'xx').length)}${c.reset}`);
}

// Note: The replace regex handles wide characters (CJK)
```

### Example 3: Percentage Color Coding (from status.mjs)
```javascript
function colorByPercent(percent) {
  if (percent >= 90) return c.red;
  if (percent >= 70) return c.yellow;
  return c.green;
}

// Usage:
const color = colorByPercent(usagePercent);
logInfo('Memory', `${color}${usagePercent.toFixed(1)}%${c.reset}`);
```

### Example 4: Spinner Pattern (from rollback.mjs)
```javascript
class Spinner {
  constructor(text) {
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.text = text;
    this.i = 0;
    this.timer = null;
  }

  start() {
    process.stdout.write('\x1b[?25l'); // hide cursor
    this.timer = setInterval(() => {
      const frame = `\r  ${c.cyan}${this.frames[this.i % this.frames.length]}${c.reset}  ${c.dim}${this.text}${c.reset}  `;
      process.stdout.write(frame);
      this.i++;
    }, 80);
    return this;
  }

  stop(icon = '', message = '') {
    clearInterval(this.timer);
    process.stdout.write('\r\x1b[2K');
    process.stdout.write('\x1b[?25h'); // show cursor
    if (message) console.log(`  ${icon}  ${message}`);
  }

  succeed(msg) { this.stop(`${c.green}✔${c.reset}`, `${c.white}${msg}${c.reset}`); }
  fail(msg)    { this.stop(`${c.red}✖${c.reset}`,   `${c.red}${msg}${c.reset}`); }
}
```

---

## Summary

The codebase has **27 scripts** with significant inconsistencies in console output styling:

- **Only 3 scripts** (status.mjs, rollback.mjs, deploy.mjs) follow the style guide well
- **22 scripts** use emoji extensively, violating the "no emoji" rule
- **5 scripts** have no color abstraction at all
- **Common patterns** are missing in most scripts (headers, sections, info lines)

**Recommended Action:**
1. Create a shared style utility module
2. Refactor all scripts to use the utility
3. Replace all emoji with ASCII-safe symbols
4. Add color abstraction to scripts missing it
5. Standardize layout patterns across all scripts

This would improve terminal compatibility and create a consistent user experience across all tools.
