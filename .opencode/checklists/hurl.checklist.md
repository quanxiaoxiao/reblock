# Hurl Test Checklist

## Structure

- [ ] directory matches OpenAPI tag
- [ ] operation mapped to correct filename
- [ ] tests grouped by operation
- [ ] maintenance/business actions use explicit action file (domain-specific, non-hardcoded example)

---

## Contract Compliance

- [ ] endpoint exists in OpenAPI
- [ ] status codes validated
- [ ] response schema asserted
- [ ] if contract-first red tests are used, expected pre-implementation failure is documented in README

---

## Pagination (if applicable)

- [ ] limit parameter tested
- [ ] offset parameter tested
- [ ] total asserted
- [ ] items array asserted
- [ ] second page requested
- [ ] stable ordering verified

---

## Stability

- [ ] captures used for cross-request validation
- [ ] pagination deterministic
- [ ] avoid global-count assertions for mutation workflows; prefer assertions tied to captured ids

---

## Cleanup

- [ ] created resources removed
- [ ] final 404 verified
