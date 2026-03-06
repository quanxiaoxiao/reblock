# Project Layout

Use this as a canonical TypeScript backend layout, but adapt it to existing repositories rather than forcing churn.

## Recommended Layout

```text
project-root/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── schemas/
│   ├── services/
│   ├── types/
│   └── utils/
├── scripts/
├── tests/
├── package.json
├── tsconfig.json
└── eslint.config.mjs
```

## Naming Conventions

- source files: `camelCase.ts`
- services: `resourceService.ts`
- routes: `resourceRouter.ts`
- schemas: `resourceSchema.ts`
- scripts: `kebab-case.mjs`
- classes and types: `PascalCase`
- constants and enum values: `UPPER_SNAKE_CASE`

## Mapping Existing Repositories

If the repo already has a different structure:

- identify where each responsibility currently lives
- preserve names that are already stable and understandable
- normalize only when the current layout creates repeated confusion or architectural drift

Typical mapping examples:

- `controllers/` often maps to `routes/`
- `validators/` often maps to `schemas/`
- `repositories/` may stay separate if the repo already distinguishes them from models

## Public Interface Expectations

- endpoint schemas expose `body`, `params`, and `query` as needed
- services accept typed plain objects and ids
- models remain persistence-facing
- shared types live in `types/` or a clearly named service-types module

## Change Strategy

Prefer:

- localized cleanup
- consistent naming for new files
- no large-scale moves unless explicitly requested

Avoid:

- renaming half the tree during a functional bug fix
- forcing a greenfield layout onto a mature repository without user approval
