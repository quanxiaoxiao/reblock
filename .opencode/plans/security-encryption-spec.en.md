# Security and Encryption Specifications

This document provides detailed implementation specifications for the security and encryption systems of the Reblock service to support implementations in other programming languages. All cryptographic implementations must be consistent to maintain interoperation ability between different language versions.

## 1. Encryption Algorithm Specifications

### AES-256-CTR Mode Encryption

All block data is encrypted using AES-256-CTR mode before storage:

**Encryption Mode**: AES-256-CTR (Counter Mode)
- Symmetric encryption algorithm
- CTR mode provides streaming characteristics, enabling random access (important for range requests)
- Key length is fixed at 256 bits (32 bytes)

**Encryption Flow**:
1. Read the base encryption key from environment variable (base64 encoded 32-byte string)
2. Generate a unique Initialization Vector (IV) per block (16 bytes total)
3. Encrypt original file data with AES-256-CTR algorithm
4. Write result to the corresponding secure storage location

**Key Format**: The value in environment variable ENCRYPTION_KEY is a base64 encoded 32-byte key string, which must be decoded to the original 32-byte sequence at runtime.

**Initialization Vector Generation Rules**:
- Generated from associated MongoDB ObjectId (12 bytes), extended to 16 bytes
- Append 4 zero bytes to the end of 12-byte ObjectId to form a 16-byte IV
- Guarantees each block receives a unique, deterministic IV

**Implementation Example - Python-like pseudocode**:
```pseudo
def derive_iv_from_object_id(object_id):
    object_id_bytes = convert_to_bytes(object_id)  # 12-byte BSON ObjectID
    assert len(object_id_bytes) == 12
    return object_id_bytes + bytes(4)  # Extend to 16 bytes
```

## 2. HMAC-SHA256 Protected Storage Path

To prevent external access to predictable file storage paths, HMAC is used to protect storage path generation:

**Core Algorithm**: HMAC-SHA256
- Used to generate secure storage filenames
- Prevents path enumeration attacks
- Requires the correct encryption key to construct valid paths

**Secure Storage Path Generation Process**:
1. Take the content's SHA256 hash value (64-character lowercase hexadecimal)
2. Apply HMAC-SHA256 using the environment encryption key to the above SHA256 hash
3. The output becomes the secure storage name (64-character lowercase hexadecimal)
4. Construct the file directory path from the storage name (first 2 chars for level 1, third char + full name for level 2)

**Storage Path Implementation - Pseudocode**:
```pseudo
def generate_storage_name(sha256_hash):
    encryption_key = base64_decode(env.ENCRYPTION_KEY)
    return hmac_sha256(encryption_key, sha256_hash)

def get_file_path(storage_name):
    prefix1 = storage_name.substring(0, 2)          # First two characters
    second_char = storage_name.substring(2, 3)      # Third character
    return f"{prefix1}/{second_char}{storage_name}"
```

**Path Construction Example**:
- Original SHA256: `a1b2c3d4e5f6...` (64-character hex)
- Secure storage name: `d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50`
- Constructed path: `d9/8d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50`
- Full path: `$STORAGE_BLOCK_DIR/d9/8d9fe03...`

## 3. Security Key Lifecycle Management

**Runtime Validation**:
- On startup, verify ENCRYPTION_KEY exists and has the correct length (32 decoded bytes)
- If key is absent or malformed, throw an exception and terminate service startup
- A default key cannot be used as this compromises security

**Environment Configuration Requirements**:
- Must use base64 encoding
- Must be 32 bytes in length (when decoded, ~44 characters in encoded string plus padding)
- Must be stored in secure environment variables rather than in code

**Security Validation Flow**:
```pseudo
def check_encryption_key():
    if env.ENCRYPTION_KEY is None or env.ENCRYPTION_KEY == "":
        raise Exception("ENCRYPTION_KEY not configured")
    
    key_bytes = base64_decode(env.ENCRYPTION_KEY)
    if len(key_bytes) != 32:
        raise Exception(f"Invalid encryption key length: {len(key_bytes)} bytes, expected 32 bytes")
    
    return key_bytes
```

## 4. Encrypted Range Request Support

**AES-256-CTR Characteristics**:
- CTR mode supports random access without decrypting the entire file
- Supports calculating offset to the correct counter value and beginning decryption

**Offset Decryption Function Requirements**:
- `create_decrypt_stream_with_offset(iv, offset)` function must correctly adjust the CTR counter
- Correctly handle block跨越: AES blocks are 16 bytes, calculate how many blocks to skip from start
- Handle partial decryption of first encrypted block: discard only the specified byte count from start

**Implementation Recommendation**:
```pseudo
def create_decryption_with_offset(iv, start_offset_bytes):
    # Each AES block is 16 bytes, calculate the starting block index
    block_size = 16
    starting_block_index = start_offset_bytes // block_size
    
    # Modify IV's last 4 bytes to incorporate the block index
    modified_iv = new Uint8Array(iv)  # Copy original IV to allow modification
    block_index_bytes = encode_uint32_be(starting_block_index)
    
    # Adjust last 4 bytes using block index (actual algorithm may require more precision)
    # XOR operation between original counter and block index
    for i in range(4):
        modified_iv[12 + i] ^= block_index_bytes[i]
    
    cipher = create_aes_ctr_cipher(key, modified_iv)
    
    # Initialize by discarding initial bytes from the first encrypted block
    skip_bytes_count = start_offset_bytes % block_size
    
    return DecryptionStream(cipher, skip_initial_bytes=skip_bytes_count)
```

## 5. Encryption Key Rotation Considerations

**Single Fixed Key Assumption for Current Version (Simplified Implementation)**:
- Key rotation is not implemented
- Future extensions may add key-version mapping to storage system

**Future Upgrade Path**:
- Each block may require an addition field to record encryption version
- Maintain multiple historical encryption keys to decrypt older data
- Encrypt new data using the latest key (encrypt only)

## 6. Security Auditing and Log Recording

**Encrypted Error Logging**:
- Log encryption failure events, but avoid exposing encryption keys in logs
- Include log information such as file SHA256, block ID for retrieval
- Do not record original data from encryption or decryption processes

**Audit Recommendations**:
- All API calls utilizing encryption/decryption operations should be logged to the log service
- Sensitive operations (such as modifying encryption configurations) require additional authentication
- Avoid directly exposing original path information in file access logs

## 7. Validation Test Vectors

To ensure consistency across different language implementations, use standard test vectors for validation:

**Test Input Example**:
- Plaintext: "Hello World"
- 32-byte key (base64): "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE="
- ObjectId: "507f1f77bcf86cd799439011"

**Expected Output**:
- Decoded key bytes: Hexadecimal byte sequence, with all content as 0x31 (32 bytes)
- Generated IV: ObjectId bytes with appended 4 zero-valued bytes
- Encrypted "Hello World": Specific encrypted byte sequence (verifiable through implementations)

This document ensures that encryption components in alternative language implementations achieve interoperability and consistent security requirements compliance.