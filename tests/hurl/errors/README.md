# Error Hurl Tests

This folder contains hurl cases for runtime error workflows.

- `acknowledge.hurl`: acknowledge flow for `/errors/:id/acknowledge`
- `resolve.hurl`: resolve flow for `/errors/:id/resolve`
- `generated/`: auto-generated repro files from `npm run errors:repro`

Generate a repro case from latest open runtime 500:

```bash
npm run errors:repro
```

Generate and run immediately:

```bash
npm run errors:repro -- --run
```
