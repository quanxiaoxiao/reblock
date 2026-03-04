# API Module Checklist

When creating a new module:

## Schema
- [ ] create schema exists
- [ ] update schema exists
- [ ] getById schema exists

## Service
- [ ] CRUD implemented
- [ ] timestamps handled
- [ ] no router dependency

## Router
- [ ] uses validate()
- [ ] calls service only
- [ ] handles 404
- [ ] correct HTTP status
- [ ] no hardcoded error messages like "Internal server error"
- [ ] all errors pass through centralized error handler

## Model
- [ ] indexes defined
- [ ] timestamps defaulted

## Business Rules
- [ ] business uniqueness enforced in service
- [ ] soft-delete aware uniqueness check exists
- [ ] 409 returned on conflict

## Pagination

- [ ] list supports optional pagination
- [ ] offset is 0-based
- [ ] paginated response returns total
- [ ] total uses same filter as query
- [ ] soft-delete filter applied to count

## Stable Pagination

- [ ] paginated queries include explicit sort
- [ ] sort includes tie-break field (_id)
- [ ] sort field is immutable
- [ ] no natural MongoDB ordering used

