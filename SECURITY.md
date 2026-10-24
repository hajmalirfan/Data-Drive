# SmartAg Ops Advisor — Security Policy

This document defines the security controls that are **mandatory** for the SmartAg
application (FastAPI backend in `agri-project/backend`, React frontend in
`agri-project/frontend`). Every change and every deployment must keep these
controls in place.

## 1. Reporting a vulnerability

Do not open a public issue for security problems. Email the maintainers privately
with steps to reproduce. We aim to acknowledge reports within 3 working days and
to fix confirmed high-severity issues within 14 days.

## 2. Authentication

| Control | Rule | Where |
|---|---|---|
| Password hashing | bcrypt via passlib; plain passwords are never stored or logged | `app/core/security.py` |
| Password policy | New passwords: at least 8 characters, at least one letter and one number, not a common password, must not contain the email name | `app/core/security_policy.py` → `password_problem` |
| Account lockout | 5 wrong passwords lock the account for 15 minutes (HTTP 423). A successful sign-in or password reset clears the counter | `routers/auth.py` → `login` |
| Account enumeration | Unknown accounts get the same "Invalid credentials" response and similar timing; forgot-password never reveals whether an email exists | `routers/auth.py` |
| Admin MFA | Admin sign-in always requires a one-time code emailed after the password check (10-minute expiry, 5 attempts, 60-second resend cooldown) | `routers/auth.py` → `send_admin_login_otp` |
| Password reset | Emailed 6-digit OTP, stored only as a keyed HMAC, single-use, 10-minute expiry, 5 attempts | `routers/auth.py` |
| Session tokens | Signed JWT (HS256), 24-hour lifetime, includes issue time (`iat`) | `app/core/security.py` |
| Session revocation | Resetting a password invalidates every session issued before it; deleting a user invalidates their sessions | `get_current_user` |
| Purpose tokens | Password-reset and admin-OTP tokens are rejected as sessions | `get_current_user` |
| Self-registration | Public sign-up can only create Farmer or Truck Operator accounts; admins are provisioned by configuration | `SIGNUP_ROLES` |

## 3. Authorization

- Every non-public endpoint requires a valid session (`get_current_user`).
- Role checks are enforced on the **backend** (`require_roles`, `require_admin`);
  hiding menu items in the frontend is a convenience, not a control.
- Admins cannot change their own role or delete their own account, and the last
  admin account cannot be deleted.
- Users can only read and change their own data (crops, bookings, documents,
  chats); admin-only routes are used for cross-user access.

## 4. Abuse protection (rate limits, per client IP)

| Endpoint group | Limit |
|---|---|
| Sign-in | 10 per minute |
| Sign-up | 10 per hour |
| Send OTP (forgot password, admin OTP resend) | 5 per 15 minutes |
| Verify OTP (reset and admin sign-in) | 10 per 5 minutes |
| Reset password | 10 per 15 minutes |
| AI chat messages | 20 per minute |
| Voice transcription | 10 per minute |

Exceeding a limit returns HTTP 429 with a `Retry-After` header. Limits are kept in
memory per backend process. When running several workers or behind a load
balancer, move them to a shared store (e.g. Redis) and make sure the real client
IP reaches the app (configure the proxy's forwarded headers).

## 5. Input and upload handling

- All request bodies are validated with Pydantic schemas; unknown roles and
  invalid values are rejected.
- Requests larger than 12 MB are rejected (HTTP 413) before being read.
- Document uploads: JPG/PNG/WebP only, 5 MB maximum, checked by file signature
  (not just the declared type), stored in the database, served only to the owner
  or an admin with `Cache-Control: no-store`.
- Voice uploads: audio types only, 10 MB maximum; audio is forwarded to the speech
  service and never stored.
- Database access goes through SQLAlchemy (parameterised queries only).

## 6. HTTP security headers

Sent by the API on every response (`app/core/security_policy.py`) and by the
frontend dev/preview servers (`vite.config.js`):

| Header | Value |
|---|---|
| `Content-Security-Policy` (API) | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera off; microphone and geolocation for this site only |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cache-Control` (API) | `no-store` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (production only) |

**Frontend Content-Security-Policy** (embedded in the built `index.html`, and sent
by `vite preview`): scripts only from the app itself; images additionally from
OpenStreetMap and Esri map tiles; network calls only to the app and the
configured API (`VITE_API_URL`); no plugins, no framing. Whatever serves the
production frontend must also send the headers above plus
`frame-ancestors 'none'`.

## 7. CORS

Only `FRONTEND_URL` may call the API (plus `localhost:5173` outside production).
Credentials (cookies) are not allowed cross-origin; authentication uses the
`Authorization` header. Allowed headers are limited to `Authorization` and
`Content-Type`.

## 8. Secrets and configuration

- Secrets live only in `backend/.env`, which is git-ignored. `.env.example`
  contains placeholders, never real keys.
- `SECRET_KEY` must be a random value of at least 32 characters. With
  `ENVIRONMENT=production` the API refuses to start if it is weak or if
  `FRONTEND_URL` is not HTTPS.
- In production the API documentation (`/docs`, `/redoc`, `/openapi.json`) is
  disabled.
- Rotate any key that has been shared in chat, email, screenshots or commits
  (database password, Gemini key, Mailtrap token, `SECRET_KEY`).
- Change the default admin password on first sign-in; it is only used to create
  the account if it does not exist.

## 9. Transport

Production must be served over HTTPS only (the frontend for the microphone and
location features, and the API for tokens). The database connection uses TLS
(`sslmode=require`).

## 10. Logging and monitoring

Security events are written to the `smartag.security` log with time, client IP
and user id, never passwords, OTPs or tokens:
`signup`, `login_success`, `login_failed`, `account_locked`,
`login_blocked_locked`, `login_password_ok_otp_sent`, `admin_otp_failed`,
`password_reset`, `role_changed`, `user_deleted`, `rate_limited`.
API request volume, error rates and response times are shown on the admin
dashboard. Keep logs for at least 90 days and review lockouts and rate-limit
events regularly.

## 11. Data protection

- Only data needed for the service is collected (name, contact, location,
  vehicle and licence details for truck operators).
- Deleting a user removes their crops, bookings, notifications, chats, documents
  and pending codes; trucks are kept but deactivated and unlinked.
- Driver documents are visible only to the owner and admins.
- AI chat messages are stored to show conversation history; voice recordings are
  not stored.

## 12. Development rules

- Never commit `.env` files, keys, database dumps or real user data.
- Keep dependencies patched; review `pip list --outdated` and `npm audit` before
  each release.
- New endpoints must declare an auth dependency (or be explicitly public and rate
  limited), validate input with a schema, and add audit events for
  security-relevant actions.
- Frontend code must not use `dangerouslySetInnerHTML` with user or AI content.

## 13. Production deployment checklist

- [ ] `ENVIRONMENT=production`
- [ ] Strong random `SECRET_KEY` (32+ characters)
- [ ] `FRONTEND_URL` and `VITE_API_URL` use `https://`
- [ ] HTTPS with a valid certificate on frontend and API
- [ ] Frontend host sends the security headers in section 6
- [ ] Default admin password changed
- [ ] All keys that were ever shared have been rotated
- [ ] Single API worker, or rate limits moved to a shared store
- [ ] Database backups enabled and access restricted
