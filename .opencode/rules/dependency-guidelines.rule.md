# Dependency Guidelines Rule

**Rule ID**: dependency-guidelines  
**Category**: Dependencies  
**Severity**: Error  
**Applies to**: package.json, npm install, PR reviews

---

## Description

All project dependencies must be pure JavaScript. Native extensions, WASM, or any non-JS code is strictly prohibited to ensure cross-platform compatibility and simplify deployment.

---

## Requirements

### 1. Node.js Version

- **Minimum**: 22.0.0
- **Recommended**: LTS (22.x)
- **Engines field** (in package.json):
  ```json
  {
    "engines": {
      "node": ">=22.0.0"
    }
  }
  ```

### 2. Module Resolution Priority

When selecting a package, follow this priority:

| Priority | Type | Example |
|----------|------|---------|
| 1 | Package with `nodejs` condition in exports/imports | `"exports": { "nodejs": "./dist/node.mjs", "default": "./dist/index.mjs" }` |
| 2 | Pure JavaScript package | `hono`, `mongoose`, `zod` |
| 3 | **Prohibited** | C++ addons, WASM, bindings |

### 3. Pure JavaScript Requirement

All dependencies must be 100% JavaScript:

**Strictly Prohibited:**
- ❌ C++ native extensions (`.node` files)
- ❌ WASM modules (`.wasm` files)
- ❌ `binding.gyp` or `node-gyp` dependencies
- ❌ `prebuild` or `prebuild-install` dependencies
- ❌ Platform-specific binaries
- ❌ Native platform APIs via FFI

**Allowed:**
- ✅ Pure JavaScript implementations
- ✅ Node.js built-in modules
- ✅ Standard npm packages without native code

### 4. Verification Steps

Before adding any dependency to the project:

#### Step 1: Check package.json red flags
```bash
# View package metadata
npm view <package-name> --json | grep -E "(gypfile|prebuild|bindings|native)"

# Red flags in output:
# - "gypfile": true
# - "scripts": { "install": "node-gyp rebuild" }
# - dependencies on "node-gyp", "prebuild", "prebuild-install", "bindings"
```

#### Step 2: Dry-run npm pack
```bash
npm pack <package-name> --dry-run 2>&1 | head -30

# Look for:
# - binding.gyp
# - *.node files
# - prebuilds/ directory
```

#### Step 3: Install and inspect
```bash
# Install in a temp directory
mkdir -p /tmp/test-pkg && cd /tmp/test-pkg
npm init -y
npm install <package-name>

# Check for native files
find node_modules/<package-name> -type f \( -name "*.node" -o -name "*.wasm" -o -name "binding.gyp" \) 2>/dev/null

# Clean up
cd ~ && rm -rf /tmp/test-pkg
```

### 5. Common Native Package Alternatives

| Native Package | Issue | Pure JS Alternative |
|---------------|-------|---------------------|
| `bcrypt` | C++ binding for bcrypt | `bcryptjs` |
| `sharp` | libvips C++ binding | `jimp` |
| `sqlite3` | SQLite C binding | Use `mongoose` instead |
| `canvas` | Cairo C++ binding | Use SVG or avoid |
| `imagemin` | Binary dependencies | `jimp` |
| `node-sass` | libsass C++ binding | `sass` (Dart Sass) |
| `pg-native` | PostgreSQL C lib | `pg` (pure JS) |

### 6. Allowed Dependencies (Examples)

Current project uses these pure JS packages:
- `hono` - Web framework (pure JS)
- `mongoose` - MongoDB ODM (pure JS)
- `zod` - Schema validation (pure JS)
- `jimp` - Image processing (pure JS since v1.0)
- `file-type` - MIME detection (pure JS since v16)
- `node-cron` - Cron scheduler (pure JS)

---

## Enforcement

### Pre-commit Check

Add to your pre-commit workflow:

```bash
#!/bin/bash
# check-native-deps.sh

echo "Checking for native dependencies..."

# Check for binding.gyp files
if find node_modules -name "binding.gyp" -type f 2>/dev/null | grep -q .; then
  echo "ERROR: Found binding.gyp files:"
  find node_modules -name "binding.gyp" -type f 2>/dev/null
  exit 1
fi

# Check for .node files
if find node_modules -name "*.node" -type f 2>/dev/null | grep -q .; then
  echo "ERROR: Found native .node files:"
  find node_modules -name "*.node" -type f 2>/dev/null | head -10
  exit 1
fi

# Check for WASM files
if find node_modules -name "*.wasm" -type f 2>/dev/null | grep -q .; then
  echo "ERROR: Found WASM files:"
  find node_modules -name "*.wasm" -type f 2>/dev/null | head -10
  exit 1
fi

echo "✓ No native dependencies found"
```

### CI/CD Pipeline

Add to `.github/workflows/ci.yml`:

```yaml
- name: Check for native dependencies
  run: |
    if find node_modules -name "binding.gyp" -o -name "*.node" -o -name "*.wasm" 2>/dev/null | grep -q .; then
      echo "Native dependencies detected!"
      exit 1
    fi
```

### PR Review Checklist

Reviewers must verify:
- [ ] No new `binding.gyp` files
- [ ] No new `.node` files
- [ ] No new WASM dependencies
- [ ] No new packages with `prebuild` or `node-gyp` in dependencies
- [ ] Package is pure JavaScript (verified via `npm pack --dry-run`)

---

## Rationale

### Why Pure JavaScript Only?

1. **Cross-Platform Compatibility**: No platform-specific compilation needed
2. **Simpler Deployment**: No native toolchain requirements
3. **Faster CI/CD**: No C++ compilation in pipelines
4. **Smaller Docker Images**: No build dependencies
5. **Better Security**: No native code execution risks
6. **Easier Maintenance**: No platform-specific debugging

### Why Node.js 22+?

- **ESM Support**: Native ES modules without flags
- **Performance**: Improved V8 engine
- **Security**: Latest security patches
- **Features**: Modern Node.js APIs (AbortController, Web Streams, etc.)
- **LTS**: Long-term support for stability

---

## Exceptions

**No exceptions allowed.** If a required feature cannot be implemented with pure JavaScript:

1. Find an alternative pure JS package
2. Implement the feature internally
3. Use a different approach (e.g., client-side processing)
4. If absolutely necessary, discuss with the team and document why native code is required

---

## Related Rules

- `.opencode/rules/import-syntax.rule.md` - Import conventions
- `.opencode/rules/hono-layer.rule.md` - Framework usage

---

## References

- [Node.js ES Modules](https://nodejs.org/api/esm.html)
- [Node.js Package Exports](https://nodejs.org/api/packages.html#packages_exports)
- [npm Package Metadata](https://docs.npmjs.com/cli/v8/configuring-npm/package-json)
