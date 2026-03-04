# Anti-Cheat Testing Rule

**Rule ID**: ts-anti-cheat-testing  
**Severity**: CRITICAL  

---

## Purpose

Prevent implementation from modifying tests to force passing.

---

## Prohibited Actions

OpenCode MUST NOT:

❌ Delete failing test cases  
❌ Remove assertions  
❌ Downgrade assertion strength  
❌ Change expected status codes  
❌ Change expected response shape  
❌ Silence errors  

---

## Allowed Actions

OpenCode MAY:

✅ Add missing test coverage  
✅ Improve test clarity  
✅ Refactor duplicate test setup  
✅ Extract shared test utilities  

---

## Implementation Rule

If tests fail:

ONLY implementation files may change:

- src/services/*
- src/routes/*
- src/models/*
- src/schemas/*
- src/utils/*

Test files are read-only contract files.

---

## Escalation

If test conflict cannot be resolved:

OpenCode MUST:

- Output conflict explanation
- Do NOT auto-resolve by weakening tests
