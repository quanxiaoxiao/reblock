# Hurl Test Checklist

## Structure

- [ ] directory matches OpenAPI tag
- [ ] operation mapped to correct filename
- [ ] tests grouped by operation

---

## Contract Compliance

- [ ] endpoint exists in OpenAPI
- [ ] status codes validated
- [ ] response schema asserted

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

---

## Cleanup

- [ ] created resources removed
- [ ] final 404 verified

