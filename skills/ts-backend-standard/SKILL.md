---
name: ts-backend-standard
description: Standardize or review TypeScript backend repositories that use or want to use Hono, Zod, strict TypeScript, and strict ESLint. Use when users ask to scaffold, refactor, audit, tighten compiler or lint settings, or fix build/lint drift while preserving an existing backend's runtime choices.
---

# TS Backend Standard

Apply a portable backend baseline for existing repositories first and greenfield work second.

## Use This Skill

Use this skill when the task is to:

- standardize a TypeScript backend structure
- add or refactor Hono routes
- introduce or tighten Zod validation boundaries
- harden `tsconfig` or `eslint.config.*`
- fix `npm run build`, `npm run typecheck`, or `npm run lint` regressions without weakening standards

Do not import Reblock-specific business rules, storage conventions, or domain models into the target repository.

## Pre-Read Order

Read these sources before analysis or edits:

1. `README.md`
2. `AGENTS.md`
3. `package.json`
4. `tsconfig*.json`
5. `eslint.config.*`
6. `src/` directory layout

Then load only the reference files needed for the task:

- `references/architecture.md` for layering, service boundaries, pagination, or DRY refactors
- `references/typescript-eslint.md` for compiler flags, lint tightening, and dependency policy
- `references/hono-zod.md` for route design, validation handoff, OpenAPI, and error responses
- `references/project-layout.md` for directory layout and naming
- `references/verification-workflow.md` for script order and final reporting

## Workflow

1. Identify the current stack and preserve it where possible.
   If the repo already uses `@hono/zod-openapi`, keep `OpenAPIHono` plus `createRoute`.
   If it uses plain `hono`, keep that style and still enforce Zod request boundaries.

2. Map the repository onto these responsibilities:
   `routes -> schemas -> services -> models`
   Equivalent folder names are acceptable if the responsibilities stay separated.

3. Enforce the core rules:
   - routers own HTTP mapping, status codes, and response formatting only
   - schemas own request contract definitions
   - services own business logic and orchestration
   - models own persistence only
   - services must not depend on Hono `Context`
   - routers must not access models directly
   - validated request data must be passed forward, not reparsed in services

4. Tighten standards with minimal necessary change.
   Prefer targeted fixes, extracted helpers, and type narrowing over broad rewrites.
   Do not relax TypeScript or ESLint rules to silence errors unless the user explicitly requests a softer policy.

5. Keep changes portable.
   Favor pure JavaScript dependencies.
   Reject native or WASM packages unless the user explicitly overrides that constraint.

## Implementation Rules

- Each endpoint should define a schema object with `body`, `params`, and/or `query` as needed.
- Validation output should be attached to request context through middleware or an equivalent typed helper.
- Keep JSON error responses consistent. If the repo already uses machine-readable error codes, preserve them.
- Prefer extraction over duplication. If similar logic appears twice, consolidate it.
- Preserve existing runtime/module choices unless the user explicitly asks to replatform them.

## Verification

Always verify with repository scripts instead of ad hoc substitutes.

Default order:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test`
4. `npm run test:hurl` when route, API contract, or error-path behavior changed

If a script does not exist, report that clearly and continue with the remaining available scripts.

## Output Contract

Return results in this order:

1. `Summary`
2. `Changes`
3. `Verification`
4. `Risks`

Keep the response implementation-focused and concise.
