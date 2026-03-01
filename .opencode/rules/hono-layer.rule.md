# Hono Router Rule

Router responsibilities:

- HTTP mapping
- validation middleware
- status codes
- response formatting

Router MUST:

- use validate()
- return JSON response
- handle 404 cases

Router MUST NOT:

- contain business logic
- access database
