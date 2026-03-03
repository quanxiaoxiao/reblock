# Error WorkFlow Rules Updates

## Changes Needed

### Problem
The current `.opencode/rules/error-fix-workflow.rule.md` file contains JavaScript/npm-specific syntax and commands that should be replaced with more universal examples.

### Specific Issues

In `error-fix-workflow.rule.md`, various sections contain npm-specific commands and test frameworks:

#### Lines 45-70:
```
# Run unit tests
npm run test

# Run integration tests
npm run test:hurl
```

#### Lines 115-118:
```
npm run test    # Must pass
npm run test:hurl  # Must pass
```

#### Lines 119-122:
```
npm run test    # Must pass
npm run test:hurl  # Must pass
```

#### Line 198:
```
npm run test && npm run test:hurl
```

#### Lines 217-220:
```
# Fetch last 7 days open errors
npm run errors:fetch

# Fetch last 30 days
npm run errors:fetch -- --days 30
...
```

And throughout lines 226-242: various npm-based commands

### Proposed Solution

Replace npm-specific commands with more generic approaches that don't assume a specific tool or platform:

#### Before:
```bash
# Run unit tests
npm run test

# Run integration tests
npm run test:hurl
```

#### After:
```bash
# Run unit tests
# [Specific command depends on your project setup]
make test-unit

# Run integration tests
# [Specific command depends on your project setup]
make test-integration
```

Or perhaps:

#### After:
```bash
# Run unit tests
# Execute your preferred test runner (e.g., npm test, yarn test, make test, etc.)
./runner.sh test-unit

# Run integration tests
# Execute your preferred test runner for integration tests
./runner.sh test-integration
```

#### Replace CLI scripts like:
```bash
npm run errors:fetch
npm run errors:fetch -- --days 30
```

With:
```bash
# Fetch errors from the error reporting service
# Implementation depends on your deployment environment
curl -s "http://localhost:4362/errors?days=7&status=open"

# Or execute equivalent script depending on environment
./scripts/get-errors.sh --days 30 --status open
```

This approach provides flexibility for different deployment and development environments while maintaining the core workflow concepts.