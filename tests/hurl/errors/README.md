# Error Hurl Tests

This folder contains hurl cases for runtime error workflows.

- `acknowledge.hurl`: acknowledge flow for `/errors/:id/acknowledge`
- `resolve.hurl`: resolve flow for `/errors/:id/resolve`
- `request-id-correlation.hurl`: request-to-error correlation by `X-Request-Id` and `/errors?requestId=...`
- `generated/`: auto-generated repro files from `npm run errors:repro`

Generate a repro case from latest open runtime 500:

```bash
npm run errors:repro
```

Generate and run immediately:

```bash
npm run errors:repro -- --run
```

Run requestId correlation template:

```bash
hurl tests/hurl/errors/request-id-correlation.hurl --variable BASE_URL=http://localhost:4362
```

If token auth is enabled on server, also pass:

```bash
--variable API_TOKEN=your-api-token
```
