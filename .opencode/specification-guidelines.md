# Opencode Examples and Documentation Specification Guidelines

## Overview

This document defines the writing standards for all specification documents in the Reblock project, aiming to ensure consistency, readability, and universality. All `.opencode/rules/*.rule.md` files should follow these specifications.

## 1. General Documentation Structure Standards

### 1.1 Basic Document Template
Each rule document should contain the following sections:
- Title (# Rule Name)
- Overview (Brief explanation of what this rule defines)
- Core Content Area (using standard format)
- Implementation Checklist (Implementation checklist section)

### 1.2 Content Organization Principles
- Organize content into logical topics with clear subsections
- Include necessary explanatory information after each section header
- Use dashes (---) to separate key concept areas

## 2. Code Example Standards

### 2.1 Recommended Usage Scenarios

#### 2.1.1 HTTP API Examples (Recommended: Use curl)
API request examples should always use curl commands rather than HTTP libs from specific programming languages:

✅ **Recommended Format**：
```bash
curl -X POST "http://localhost:3000/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Documents"
  }'
```

❌ **Not Recommended Format**：
```javascript
// JavaScript fetch
fetch('/entries', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({...})
})

// Or axios
axios.post('/entries', {...})
```

#### 2.1.2 General Data Structure Examples (Recommended: JSON Structure)

Use pure JSON syntax to define data structures, avoiding specifying implementation languages:

✅ **Recommended Format**：
```json
{
  "status": "resolved",
  "changedAt": 1772241200000,
  "changedBy": "cleanup-script",
  "note": "Soft deleted via cleanup script"
}
```

❌ **Not Recommended Format**：
```javascript
// JavaScript object literal
{
  status: 'resolved',
  changedAt: 1772241200000,
  changedBy: 'cleanup-script',
  note: 'Soft deleted via cleanup script'
}
```

#### 2.1.3 Pseudocode/Algorithm Examples (Recommended: General Programming Concepts)

Use pseudocode that is not tied to specific languages：

✅ **Recommended Format**：
```
CLIENT PROCEDURE uploadFile(alias, file):
    INPUT: alias (string), file (binary/object)
    OUTPUT: upload response or appropriate error
    
    SEND HTTP POST REQUEST to "/upload/" + alias with file content
    STORE response
    
    IF response status is 2xx:
        PARSE response as JSON
        RETURN parsed response
    END IF
    
    PARSE error response as JSON
    RESPONSE STATUS CODE determines error handling...
    END CONDITIONAL
END PROCEDURE
```

❌ **Not Recommended Format**：
```
async function uploadFile(alias, file):  # JavaScript style
    response = await POST(...)

# Or
func uploadFile(alias string, file []byte)  # Go style
```

### 2.2 Syntax That Should Not Be Used

- Avoid any specific programming language syntax, such as `async/await`, `Promise`, `->`, `=>`, `:` (object declaration), `.` (method calls)
- Avoid specific type declarations, such as `let`, `const`, `var`, `int`, `string`
- Avoid including specific library/framework names or specific package import statements

## 3. API Request Example Standards (CURL Preferred)

### 3.1 HTTP Request/Response Example Format
Provide complete request/response examples, organized as follows:

```
POST /entries
Content-Type: application/json

{
  "name": "My Documents"
}

HTTP 201 Created
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "My Documents"
}
```

### 3.2 cURL Example Specifications
When providing command-line examples：
- Always start with `curl -X <METHOD> "URL"`
- Split long commands across multiple lines using `\` line continuation
- Use `-H` before `Content-Type` headers
- Use `-d` parameter for request body, wrap JSON with single quotes
- Indent continuations to align with command start

### 3.3 Parameter Description Tables
For endpoints requiring parameter descriptions, use the following table format:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name      | string | Yes      | Display name |

## 4. Data Structure Definition Standards

### 4.1 General Data Structure Markup
Define data structures using the following format:

```
DATA STRUCTURE StructureName:
- property1: TypeName (Description)
- property2: Optional TypeName (Description)
- property3: Array[TypeName] (Description of array items)
```

### 4.2 Interface/Entity Definitions
For interface definitions use TypeScript style, maintaining generality：

```typescript
interface EntityName {
  _id: string;
  property: TypeName;  // Description
}
```

## 5. State and Process Representation Standards

### 5.1 State Transition Diagrams
Draw state transition diagrams using ASCII style：

```
                    ┌─────────────┐
                    │    open     │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ┌─ ack ─▶ ┌─────────────┐   ┌─────────────┐
         │         │acknowledged │   │  resolved   │
         ▼         └──────┬──────┘   └─────────────┘
  ┌─────────────┐         │
  │   ignored   │ ────────► resolved
  └─────────────┘        ┌─────────────┐
                         │  (final)    │
                         └─────────────┘
```

### 5.2 State Transition Matrix
Use table format to define allowed transitions:

| Source \ Target | `open` | `acknowledged` | `resolved` | `ignored` |
|-----------------|--------|----------------|------------|-----------|
| `open`          | -      | ✅             | ✅         | ✅        |
| `acknowledged`  | ❌     | -              | ✅         | ✅        |

### 5.3 Decision Process Descriptions
For business processes, use step numbering or conditional logic diagrams.

## 6. Table and List Standards

### 6.1 Two-dimensional Relation Tables
For displaying mapping/correspondence relationships：

| Code | HTTP Status | Description |
|------|-------------|-------------|
| NOT_FOUND | 404 | Resource not found |

### 6.2 Simple List Tables
When only listing items, use concise format：

- Item 1
- Item 2
- Item 3

### 6.3 Feature Comparison Tables
When comparing features, use features as first column：

| Feature | Current Behavior | New Requirement |
|---------|------------------|------------------|
| Auth | Basic | JWT |

## 7. Error Handling Example Standards

### 7.1 Standard Error Format
Unified error response format definition：

```json
{
  "error": "Human-readable message",
  "code": "PROGRAMMATIC_ERROR_CODE" 
}
```

### 7.2 Specific Error Type Format
When providing detailed error information (e.g. validation errors)：

```json
{
  "error": "Validation error",
  "details": [
    {
      "field": "name",
      "message": "String must contain at least 1 character"
    }
  ]
}
```

## 8. Comments and In-document References

### 8.1 Inline Comments
Use standard Markdown comment format or add brief explanations at end of lines.
- Code blocks: avoid language-specific comment delimiters
- Tables: when necessary use descriptive text to explain complex fields

### 8.2 Cross-document References
- When referring to other rule files, use file names
- When referring to other services or methods, use descriptive reference rather than specific language implementations

## 9. Overall Layout Suggestions

### 9.1 Section Organization Structure
1. Concept Introduction
2. Technical Details 
3. Practical Examples
4. Behavior Matrices/Processes
5. Implementation Notes
6. Verification/Testing Points

### 9.2 Reading Flow
- Each section should deepen gradually, from easier to harder topics
- Dashes separate different types of information clearly
- Graphs follow their textual descriptions closely
- Implementation check lists placed at the end

## 10. Content Adaptations for Different Document Types

### 10.1 Rule-type Documents
- Define explicit behavioral boundaries
- Distinguish clearly with allow/disallow labels
- Include trigger conditions and expected behaviors

### 10.2 Process-type Documents  
- Sequential timeline steps
- Decision point markers
- Optional execution paths

### 10.3 Configuration/Architecture Documents
- Annotate relationships between components
- Show data flow direction
- Document layered structure relationships