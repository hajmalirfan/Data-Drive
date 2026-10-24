// Mirrors backend/app/core/security_policy.py (the backend is the source of truth).
export const PASSWORD_MIN_LENGTH = 8

// Returns true when a new password meets the policy: 8+ chars, a letter and a number.
export function meetsPasswordPolicy(password) {
  return (
    password.length >= PASSWORD_MIN_LENGTH
    && password.length <= 128
    && /[A-Za-z]/.test(password)
    && /\d/.test(password)
  )
}
