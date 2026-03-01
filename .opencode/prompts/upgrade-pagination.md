Upgrade all modules to comply with pagination rules.

Run apply-rules-refactor across all services
that expose list() methods.

Ensure:
- offset is 0-based
- pagination optional
- stable sorting

