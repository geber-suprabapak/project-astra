import { describe, it, expect } from 'vitest'
import {
  UpdatePasswordSchema,
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_SIZE_BYTES,
} from '../../../src/modules/profile/schema.js'
import {
  REQUIRED_ENROLLMENT_FILES,
  MAX_ENROLLMENT_FILE_SIZE_BYTES,
  ALLOWED_ENROLLMENT_CONTENT_TYPE,
} from '../../../src/modules/enrollment/schema.js'

describe('UpdatePasswordSchema', () => {
  it('accepts valid password change', () => {
    const result = UpdatePasswordSchema.safeParse({
      current_password: 'oldPassword123',
      new_password: 'newPassword456',
    })
    expect(result.success).toBe(true)
  })

  it('rejects new_password shorter than 8 characters', () => {
    const result = UpdatePasswordSchema.safeParse({
      current_password: 'oldPassword123',
      new_password: 'short',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing current_password', () => {
    const result = UpdatePasswordSchema.safeParse({
      new_password: 'newPassword456',
    })
    expect(result.success).toBe(false)
  })
})

describe('Enrollment schema constants', () => {
  it('requires exactly 10 files', () => {
    expect(REQUIRED_ENROLLMENT_FILES).toBe(10)
  })

  it('max enrollment file size is 2MB', () => {
    expect(MAX_ENROLLMENT_FILE_SIZE_BYTES).toBe(2 * 1024 * 1024)
  })

  it('allowed enrollment content type is image/jpeg', () => {
    expect(ALLOWED_ENROLLMENT_CONTENT_TYPE).toBe('image/jpeg')
  })
})

describe('Avatar schema constants', () => {
  it('allowed avatar types include jpeg, png, webp', () => {
    expect(ALLOWED_AVATAR_TYPES).toContain('image/jpeg')
    expect(ALLOWED_AVATAR_TYPES).toContain('image/png')
    expect(ALLOWED_AVATAR_TYPES).toContain('image/webp')
  })

  it('max avatar size is 5MB', () => {
    expect(MAX_AVATAR_SIZE_BYTES).toBe(5 * 1024 * 1024)
  })
})
