# Backend API

This backend provides authentication endpoints with email verification and password reset flows.

## Environment

Copy `.env.example` to `.env` and fill in values:

- PORT, APP_BASE_URL, FRONTEND_URL
- MONGO_URI
- JWT_SECRET
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM

## Endpoints

Base path: `/api/v1/auth`

- `POST /register` — body: `{ name, email, password }`
  - Sends a verification email.
- `POST /login` — body: `{ email, password }`
  - Requires verified email.
- `POST /send-verification` — body: `{ email }` — resend verification email.
- `GET /verify-email?token=...&email=...` — verify email.
- `POST /forgot-password` — body: `{ email }` — send reset link.
- `POST /reset-password?token=...&email=...` — body: `{ password }` — reset password.

## Dev

- Install deps: `npm install`
- Run dev: `npm run dev`

