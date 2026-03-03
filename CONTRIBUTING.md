# Contributing to Reblock

Thank you for your interest in contributing to Reblock! This document provides guidelines for contributing to this project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. We expect all contributors to follow our code of conduct:

- Be respectful and inclusive
- Use welcoming and inclusive language
- Accept constructive criticism gracefully
- Focus on what is best for the community

## Getting Started

### Fork the Repository

1. Click the "Fork" button on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/reblock.git
   cd reblock
   git remote add upstream https://github.com/reblock/reblock.git
   ```

### Development Environment Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment file:
   ```bash
   cp .env.example .env
   ```

3. Configure your `.env` file with your MongoDB connection and encryption key.

4. Start the development server:
   ```bash
   npm run dev
   ```

### Adding Dependencies

**Important**: Before adding any new npm dependency, you **must** verify it complies with our [Dependency Guidelines](.opencode/rules/dependency-guidelines.rule.md):

- **Node.js 22+** is required
- All dependencies must be **pure JavaScript** (no C++ native extensions, WASM, or bindings)
- Module resolution priority: packages with `nodejs` condition in `exports`/`imports`

**Verification checklist:**
```bash
# Check package for native code red flags
npm view <package-name> --json | grep -E "(gypfile|prebuild|bindings)"

# After installation, verify no native files
find node_modules/<package-name> -name "*.node" -o -name "*.wasm" -o -name "binding.gyp" 2>/dev/null
```

If a package contains native code, find a pure JavaScript alternative or implement the functionality internally.

### Running Tests

```bash
# Unit tests
npm run test

# End-to-end tests
npm run test:e2e

# Integration tests
npm run test:hurl

# With coverage
npm run test:coverage
```

## Coding Standards

### Code Style

- This project uses ESLint for code linting
- Run `npm run lint` before committing
- Fix linting errors with `npm run lint:fix`

### TypeScript

- This project uses TypeScript
- Run `npm run typecheck` to verify type safety
- All new code should be properly typed

### Git Commit Messages

Follow conventional commits:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Build process, dependencies

Example:
```
feat(block): add block deduplication verification

- Added verification step to ensure linkCount accuracy
- Added test cases for deduplication scenarios
```

### Pull Request Process

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

2. **Make your changes** and commit them

3. **Run tests and linting**:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   ```

4. **Verify no native dependencies** (if you added/updated packages):
   ```bash
   # Check for prohibited native files
   find node_modules -name "*.node" -o -name "*.wasm" -o -name "binding.gyp" 2>/dev/null
   ```
   If any files are found, remove the offending package and use a pure JS alternative.

4. **Push to your fork**:
   ```bash
   git push origin your-branch-name
   ```

5. **Create a Pull Request**:
   - Fill out the PR template completely
   - Link any related issues
   - Ensure all CI checks pass

6. **Review process**:
   - Address any feedback or changes requested
   - Once approved, your PR will be merged

## Project Structure

```
reblock/
├── src/                 # Source code
│   ├── config/         # Configuration
│   ├── middleware/     # Express middleware
│   ├── models/         # Mongoose models
│   ├── routes/        # API routes
│   ├── services/      # Business logic
│   └── utils/         # Utilities
├── scripts/            # CLI scripts
├── tests/              # Test files
├── storage/            # Data storage
└── Dockerfile          # Container definition
```

## API Documentation

When adding new API endpoints:

1. Use Zod schemas for request/response validation
2. Add OpenAPI annotations
3. Test the endpoint with hurl tests in `tests/hurl/`

## Adding Tests

- Unit tests: `tests/` with Vitest
- Integration tests: `tests/hurl/`
- E2E tests: `scripts/e2e-test.mjs`

## Questions?

If you have questions, feel free to open a discussion on GitHub or reach out to the maintainers.

---

Thank you for contributing to Reblock!
