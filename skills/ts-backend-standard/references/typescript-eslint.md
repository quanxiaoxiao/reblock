# TypeScript And ESLint

Use strict TypeScript as the baseline and tighten ESLint without forcing mass refactors in mature repositories.

## TypeScript Baseline

Recommended compiler flags:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false
  }
}
```

Prefer enabling these in place rather than creating a separate loose config.

## ESLint Baseline

For TypeScript source files, enforce:

- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/explicit-function-return-type`
- `@typescript-eslint/consistent-type-imports`
- `@typescript-eslint/no-unused-vars`
- no `require()` in source
- no dynamic `import()` in source unless the repository explicitly relies on it

Pragmatic defaults:

- keep declaration files (`*.d.ts`) on a narrower rule set
- keep script files on a separate rule set when they are operational tooling rather than application code
- prefer non-type-aware strict presets first when tightening a mature repo
- add type-aware `unsafe-*` rules only when the codebase is already close to compliance

## Incremental Hardening

When tightening an existing repository:

1. enable compiler strictness first
2. fix real type issues instead of widening types
3. enable strict ESLint rules that improve maintainability without exploding the change surface
4. avoid weakening rules only to make the build pass

Prefer:

- `unknown` in catch variables
- explicit narrowing and small helper guards
- `type` imports for type-only dependencies
- explicit return types on exported or behavior-critical functions

Avoid:

- switching everything to `any`
- disabling whole rule families globally
- adding broad file-level ignores when a local fix is possible

## Dependency Policy

Default recommendation:

- use `Node 22+`
- prefer pure JavaScript dependencies
- reject native extensions, platform binaries, and WASM packages unless the user explicitly asks for them

When evaluating a new package, check for:

- `binding.gyp`
- `.node` files
- `.wasm` files
- `node-gyp`, `prebuild`, or `prebuild-install`

## Verification Mindset

Compiler and lint fixes should preserve behavior.

After tightening:

- run `npm run typecheck`
- run `npm run lint`
- run tests required by the repository

If strictness work reveals large legacy drift, report the remaining categories clearly instead of silently softening the standard.
