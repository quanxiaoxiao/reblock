# Rules Files Specification Conformance Analysis Report

## Compliant Aspects
1. Most files use appropriate cURL command examples
2. Utilize general data structure representations (like JSON, DATA STRUCTURE)
3. Apply proper state flow diagrams (ASCII style)
4. Many files follow standard error formats

## Major Issues of Non-compliance

### 1. API Request Examples: Using Undesired Language-Specific Format Rather Than cURL

**File:** `/Users/huzhedong/temp/resources/.opencode/rules/service-interface.rule.md`
**Issue:** Uses multiple `http` format examples instead of cURL examples
**Lines:** 51, 74, 91, 115, 146, 172, 192, 209, 251, 283, 303, 317, 332, 360, 387, 402, 417, 459, 497, 524, 561

These HTTP format examples should be replaced with cURL command examples.

### 2. Code Examples Use Specific Language Syntax Rather Than Language-Neutral Format

**File:** `/Users/huzhedong/temp/resources/.opencode/rules/entry-default.rule.md`
- **Line 55:** `async getOrCreateDefault(): Promise<IEntry> {` - Uses JavaScript-specific async/promise syntax 
- **Line 56:** `const existing = await Entry.findOne(...)` - Contains JavaScript async/await syntax
- **Line 82:** `.then(async () => {` - Uses JavaScript Promise.then syntax

**File:** `/Users/huzhedong/temp/resources/.opencode/rules/error-fix-workflow.rule.md`
- **Line 200:** `async getById(id: string): Promise<IEntry | null> {` - Contains TypeScript type syntax 

According to section 2.2 of the specification, specific programming language syntax should be avoided, such as `async/await`, `Promise`, `->`, `=>`, `:` (object declaration), `.` (method calls), `:` (type annotations), etc.

### 3. Data Structure Definitions Have Inconsistencies

Most files adopt the DATA STRUCTURE format or JSON notation, which is quite compliant, but some places still have TypeScript interface syntax:
- In `/Users/huzhedong/temp/resources/.opencode/rules/data-model.rule.md` and `/Users/huzhedong/temp/resources/.opencode/rules/service-interface.rule.md` there are still TypeScript interface definitions.
- Like line 70 `interface Entry`, etc. Although this might describe model interfaces, it still leans toward language-specific implementation.

### 4. Other Issues Worth Noting

1. Several functions use TypeScript type annotations (such as `: Promise<IEntry>`), which should be avoided in function signatures with this kind of language-specific typing
2. Some documentation contains JavaScript-specific error concepts that should be expressed more generically

## Improvement Suggestions

### For API Request Examples
Replace all http format examples in service-interface.rule.md with cURL commands, for example:
```
GET /blocks/60d21b4667d0d8992e610c85
HTTP 200 OK
```
Should be changed to:
```bash
curl -X GET "http://localhost:3000/blocks/60d21b4667d0d8992e610c85"
```

### For Language-Specific Code Examples
Modify the function definitions in entry-default.rule.md to generic algorithm representations:
```typescript
async getOrCreateDefault(): Promise<IEntry> {
  const existing = await Entry.findOne({ isDefault: true, isInvalid: { $ne: true } });
```
Should be changed to:
```
FUNCTION getOrCreateDefault():
    QUERY for an existing valid entry with isDefault=true
    IF found THEN
        RETURN existing entry
    ELSE
        CREATE a new entry with isDefault=true
        SAVE the new entry
        RETURN the saved entry
    END IF
END FUNCTION
```

Overall, despite most documents following the specification, specific language syntax still needs cleaning to ensure the documentation fully complies with language-agnostic principles and standard API example requirements (cURL).