# Error Handling Rules Generalization

## Changes Needed

### Problem
The current `.opencode/rules/error-handling.rule.md` file has some specific syntax and client examples that could be made more universally applicable.

### Specific Issues

Lines 258-289 contain a pseudocode example that assumes a certain style of HTTP request handling:
```
### Generic Client Example (Pseudocode)

```
async function uploadFile(alias, file):
    response = await POST(`/upload/${alias}`, file)
    
    if response.ok:
        return response.json()
    
    error = await response.json()
    
    switch response.status:
        case 413:
            throw Error(`File too large: ${error.error}`)
        case 415:
            throw Error(`Invalid file type: ${error.error}`)
        case 403:
            throw Error(`Entry is read-only: ${error.error}`)
        case 404:
            throw Error(`Entry not found: ${error.error}`)
        default:
            throw Error(`Upload failed: ${error.error}`)
```
```

While this is pseudocode, it still uses specific JavaScript-like syntax with template literals (`` `${}` ``), async/await pattern, and JavaScript-style error handling.

### Proposed Solution

Replace this with even more generic pseudocode that's not tied to any particular language syntax:

```
### Generic Client Example (Language-Independent Approach)

CLIENT PROCEDURE uploadFile(alias, file):
    INPUT: alias (string), file (binary/object)
    OUTPUT: upload response or throws appropriate error
    
    SEND HTTP POST REQUEST to "/upload/" + alias with file content
    STORE response
    
    IF response status is 2xx:
        PARSE response as JSON
        RETURN parsed response
    END IF
    
    PARSE error response as JSON
    RESPONSE STATUS CODE determines error handling:
        CASE 413: 
            RAISE "File too large" error with details from response
        CASE 415: 
            RAISE "Invalid file type" error with details from response
        CASE 403: 
            RAISE "Entry is read-only" error with details from response
        CASE 404: 
            RAISE "Entry not found" error with details from response
        DEFAULT: 
            RAISE "Upload failed" error with details from response
    END CONDITIONAL
    
END PROCEDURE
```

This approach avoids specific syntax elements like `await`, template literals, `switch` vs `case`, and would be understandable regardless of the target programming language.