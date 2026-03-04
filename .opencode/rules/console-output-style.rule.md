# Console Output Style Guide

Guidelines for formatting terminal output across all languages and tools.

---

## Color Semantics

| Color    | ANSI Code  | Hex       | Meaning                            | Example      |
| -------- | ---------- | --------- | ---------------------------------- | ------------ |
| Green    | `\x1b[32m` | `#00ff00` | Success, healthy, running          | `✔ ok`       |
| Yellow   | `\x1b[33m` | `#ffff00` | Warning, attention needed          | `! warning`  |
| Red      | `\x1b[31m` | `#ff0000` | Error, critical                    | `✖ error`    |
| Cyan     | `\x1b[36m` | `#00ffff` | Interactive elements, primary info | `[prompt]`   |
| Blue     | `\x1b[34m` | `#0000ff` | Links, references                  | `http://...` |
| Magenta  | `\x1b[35m` | `#ff00ff` | Special highlights                 |              |
| White    | `\x1b[37m` | `#ffffff` | Primary data values                | `42%`        |
| Gray/Dim | `\x1b[2m`  | `#808080` | Secondary info, labels, hints      | `(metadata)` |
| Reset    | `\x1b[0m`  |           | Reset all styles                   |              |

**Background Colors (use sparingly):**

* `\x1b[41m` — Red background (critical alerts)
* `\x1b[42m` — Green background (success emphasis)
* `\x1b[43m` — Yellow background (warnings)

---

## Typography

| Style    | ANSI Code | Usage                             |
| -------- | --------- | --------------------------------- |
| **Bold** | `\x1b[1m` | Headers, section titles, emphasis |
| *Italic* | `\x1b[3m` | Special annotations, quotes       |
| Dim      | `\x1b[2m` | Labels, dividers, secondary text  |

---

# Layout Patterns

## 1. Header Pattern

Use for application/command entry point:

```
[Bold Title]  [Dim Context/Host]  [Dim Timestamp]
[Divider Line]
```

Example:

```
Reblock Server Status  user@host:22  2026-03-04 09:30:15
────────────────────────────────────────────────────
```

**Specifications:**

* Title: Bold white, left-aligned
* Context: Dim gray, at least 2 spaces after title
* Timestamp: Dim gray, aligned right if layout allows
* Divider: Dim gray, 52 characters width (adjustable)

---

## 2. Section Pattern

Group related information:

```

[Bold Section Title]
[Underline matching visual width]
```

**Specifications:**

* Empty line before section
* Title: Bold
* Underline: Dim, same visual width as title
* For wide characters (e.g., CJK), count as double width when calculating underline length

---

## 3. Info Line Pattern

Standard key-value display:

```
  [Label: padded] [Value: colored]  [Hint: dim]
```

**Specifications:**

* Indent: 2 spaces
* Label:

  * Dim
  * Right-padded to fixed width (recommended: 16 characters)
* Value:

  * Color-coded based on status/type
* Hint:

  * Optional
  * Dim
  * At least 2 spaces after value

---

## 4. List Pattern

For enumerated items:

```
  • [Item 1]
  • [Item 2]
```

With status:

```
  ✔ [Success item]
  ! [Warning item]
  ✖ [Error item]
  - [Neutral item]
```

---

# Status Indicators

| Indicator | Color   | Meaning                    | Usage                          |
| --------- | ------- | -------------------------- | ------------------------------ |
| `✔`       | Green   | Success, complete, healthy | Status checks, completed tasks |
| `✖`       | Red     | Error, failed, critical    | Failures, blocked operations   |
| `!`       | Yellow  | Warning                    | Needs attention                |
| `→`       | Cyan    | Progress, direction        | Flow indication                |
| `•`       | Neutral | Bullet point               | Lists                          |
| `…`       | Dim     | Loading, continuation      | Ongoing operation              |

**Avoid emojis.** Use ASCII-safe symbols for maximum terminal compatibility.

---

# Data Formatting

## Percentages

Color-code by thresholds:

```
< 70%   → Green
70–90%  → Yellow
> 90%   → Red
```

Format rules:

* Value colored
* `%` symbol dim
* Example: `45.2%` (number colored, `%` dim)

---

## Duration

Format:

```
[Value][Unit]
```

Examples:

```
5d 3h
3h 45m
45m 30s
30s
```

Rules:

* Show only 2 most significant units
* Units: `d`, `h`, `m`, `s`
* No space between number and unit
* Values in white, units dim

---

## File Sizes

Use decimal units:

* 1 KB = 1000 B

Formatting:

```
< 1 KB      → "456 B"
< 1 MB      → "456.7 KB"
< 1 GB      → "456.78 MB"
≥ 1 GB      → "4.56 GB"
```

Rules:

* No decimals for bytes
* 1 decimal for KB
* 2 decimals for MB/GB

---

## Numbers

* Use comma separators: `1,234,567`
* Keep consistent decimal precision within context
* Currency: always 2 decimal places

---

# Error Display

## Simple Error

```
✖ [Error message]
```

## Detailed Error

```
✖ [Brief error title]
  [Detailed description]
  [Suggestion / fix]
```

Structure:

* First line: colored symbol + short summary
* Following lines:

  * Indented 2 spaces
  * Description in default color
  * Suggestions in dim or neutral tone

---

# Progress Indicators

## Loading Spinner

```
[Frame] Message...
```

Recommended frames:

```
⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
```

Rules:

* Frame updates in place
* Message remains stable
* End with success or failure symbol

---

## Progress Bar

```
[██████░░░░] 60%  [Message]
```

Rules:

* 10 blocks total
* Filled blocks = progress ÷ 10
* Percentage colored by threshold
* Message optional

---

# Generic Implementation Requirements (Language-Agnostic)

Instead of language-specific helpers, implementations MUST follow these behavioral contracts:

## 1. Color Abstraction Layer

The system SHOULD:

* Provide symbolic color identifiers (e.g., `SUCCESS`, `WARNING`, `ERROR`)
* Map them internally to ANSI codes
* Always append reset after colored output
* Provide a fallback to no-color mode when terminal does not support ANSI

---

## 2. Section Rendering Contract

A section renderer MUST:

1. Print a newline
2. Print bold title
3. Calculate visual width (considering wide characters)
4. Print underline using matching width
5. Reset formatting after each styled segment

---

## 3. Info Line Rendering Contract

An info line renderer MUST:

1. Indent 2 spaces
2. Pad label to fixed width
3. Apply dim style to label
4. Apply semantic color to value
5. Optionally append hint in dim style

---

## 4. Percent Color Resolver

A percent formatter MUST:

* Accept numeric input
* Determine threshold range
* Return styled string with:

  * Colored numeric value
  * Dim percent symbol
* Never embed business logic outside formatter

---

## 5. Error Renderer

An error renderer MUST:

* Print red `✖`
* Keep first line concise
* Indent detailed explanation
* Separate logical parts with spacing

---

## 6. Terminal Safety Rules

Every implementation MUST:

* Reset styles after each colored segment
* Avoid color bleeding across lines
* Support terminals without Unicode (fallback to ASCII if needed)
* Keep line width under 80 characters when possible

---

# Best Practices

1. **Consistency** — Same meaning → same color everywhere
2. **Contrast** — Readable on dark and light terminals
3. **Brevity** — Short primary message, details in hints
4. **Accessibility** — Never rely only on color
5. **Structure** — Use whitespace intentionally
6. **Compatibility** — No emoji
7. **Reset discipline** — Always reset styles
8. **Deterministic formatting** — Avoid layout shifts

---

# Example Outputs

## Server Status

```
Reblock Server Status  prod-01  2026-03-04 09:30:15
────────────────────────────────────────────────────

Container
─────────
  Status           running
  Uptime           5d 3h
  Restarts         0
  Health           healthy

System
──────
  CPU              45.2%             8 cores
  Load Avg         0.85              1m / 5m / 15m
  Memory           67.3%             3.2 GB / 4.8 GB
  Disk storage     72.5%             45 GB / 62 GB

✔ all systems operational
```

---

## Error

```
✖ Deployment failed
  Build exited with code 1
  Check logs: npm run logs
```

---

## Progress

```
⠋ Installing dependencies...
⠙ Installing dependencies...
⠹ Installing dependencies...
✔ Dependencies installed (2.3s)
```

