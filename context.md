# Codebase Context

## Project Overview

A real-time peer-to-peer connection platform for college students. Users match with strangers from the same or other colleges, connect via WebRTC video/audio, chat, and watch videos together. Authentication is restricted to verified college email domains only.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM — `"type": "module"`) |
| HTTP server | Express |
| Real-time | Socket.IO |
| Database | MongoDB + Mongoose |
| Auth | JWT (access + refresh) + Google OAuth 2.0 |
| OTP email | Resend |
| Password hashing | bcrypt |
| WebRTC signalling | Socket.IO relay (offer/answer/ICE) |

---

## Environment Variables

```
PORT                    HTTP server port (default 5000)
NODE_ENV                development | production
MONGODB_URI             MongoDB connection string
JWT_SECRET              Access token signing secret (min 32 chars)
JWT_REFRESH_SECRET      Refresh token signing secret (different from above)
GOOGLE_CLIENT_ID        Google OAuth app client ID
GOOGLE_CLIENT_SECRET    Google OAuth app client secret
GOOGLE_CALLBACK_URL     e.g. http://localhost:5000/api/auth/google/callback
RESEND_API_KEY          Resend API key (re_...)
APP_NAME                Displayed in email sender name
FRONTEND_URL            e.g. http://localhost:3000
ALLOWED_EMAIL_DOMAINS   Comma-separated college domains e.g. iitk.ac.in,iitb.ac.in
ALLOWED_ORIGINS         Comma-separated CORS origins for Socket.IO
```

---

## Folder Structure

```
├── index.js                         Entry point — Express + HTTP server + Socket.IO init
│
├── socket/                          All real-time logic
│   ├── index.js                     Creates Socket.IO server, applies auth middleware, bootstraps events
│   ├── events.js                    Registers all socket event handlers in lifecycle order
│   ├── socket.state.js              Single source of truth for per-socket state (Map)
│   │
│   ├── middlewares/
│   │   └── auth.middleware.js       JWT socket auth — attaches socket.user or blocks connection
│   │
│   ├── handlers/
│   │   ├── webrtc.handler.js        offer / answer / ice-candidate relay
│   │   ├── chat.handler.js          chat-message relay within a room
│   │   └── watchparty.handler.js    join-watch-party / play / pause / seek sync
│   │
│   ├── services/
│   │   ├── match.service.js         Matchmaking queue, interest scoring, timeout, cleanup
│   │   ├── room.service.js          joinRoom / leaveRoom — Socket.IO room membership + peer notification
│   │   └── watchparty.service.js    Watch party state — joinParty / updateParty
│   │
│   └── utils/
│       └── validate.js              Input validators: validateMeta, validateRoomId, validateMessage,
│                                    validatePartyId, validateTime
│
└── src/
    └── auth/                        All authentication logic
        ├── auth.routes.js           Express router — mounts all auth endpoints
        ├── auth.controller.js       Thin controllers + central errorHandler middleware
        │
        ├── config/
        │   ├── auth.config.js       Secrets, token expiry, allowedDomains, Google creds
        │   ├── passport.js          Passport strategies: JWT (REST protection) + Google OAuth
        │   └── resend.js            Resend client + sendOtpEmail() helper
        │
        ├── middlewares/
        │   └── auth.middleware.js   protect (JWT required) + optionalAuth (guest-friendly)
        │
        ├── models/
        │   ├── otp.model.js         OTP codes — MongoDB TTL index auto-expires documents
        │   └── token.model.js       Refresh tokens stored as bcrypt hashes — TTL auto-purge
        |   |__ user.model.js
        │
        ├── services/
        │   ├── auth.service.js      register, verifyEmail, login, oauthLogin, logout, resendOtp
        │   ├── otp.service.js       sendOtp (via Resend), verifyOtp (checks code + expiry)
        │   └── token.service.js     signAccessToken, issueRefreshToken, rotateRefreshToken, revokeAllTokens
        │
        └── utils/
            ├── hash.util.js         bcrypt wrappers: hashPassword, verifyPassword, hashToken, verifyToken
            ├── otp.util.js          crypto.randomInt → zero-padded 6-digit string
            └── domain.guard.js      isAllowedDomain(email) — checks against ALLOWED_EMAIL_DOMAINS
```

> **User model** lives at `src/auth/models/User.js` (shared across auth + other features).

---

## Data Models

### `User` (`src/models/User.js`)
Core user document. Fields:

| Field | Type | Notes |
|---|---|---|
| `email` | String | Unique, lowercase, trimmed, regex-validated |
| `username` | String | Optional, unique sparse index, 3–20 chars |
| `passwordHash` | String | bcrypt hash. Value `"oauth"` = Google-only account (no password login) |
| `fullName` | String | Required, max 50 chars |
| `avatar` | String | URL or path, defaults to `"default-avatar.png"` |
| `university` | String | Optional |
| `major` | String | Optional |
| `graduationYear` | Number | 1900 to current year + 10 |
| `bio` | String | Max 300 chars |
| `interests` | [String] | Used for interest-based matchmaking scoring |
| `isVerified` | Boolean | true after OTP or Google OAuth confirmation |
| `friends` | [ObjectId] | Ref User |
| `friendRequests` | `{ incoming, outgoing }` | Both arrays of ObjectId ref User |
| `blockedUsers` | [ObjectId] | Ref User |
| `hostingPoints` | Number | Gamification — default 0 |
| `role` | String | `"user"` or `"admin"` |
| `lastActive` | Date | Updated on activity |
| `settings` | Object | `micEnabled`, `cameraEnabled`, `preferredCameraId`, `preferredMicId`, `theme` |
| `createdAt` / `updatedAt` | Date | Auto via timestamps |

Instance method `toProfileJSON()` returns safe public fields (no passwordHash).

### `Otp` (`src/auth/models/otp.model.js`)
Temporary OTP codes. MongoDB TTL index on `expiresAt` — auto-deleted when expired. One record per email (previous deleted on new send).

### `Token` (`src/auth/models/token.model.js`)
Refresh token store. Token stored as bcrypt hash (never plaintext). TTL index auto-purges expired records. Indexed by `userId` for fast revocation.

---

## Auth Flow

### Email + Password registration
```
POST /api/auth/register
  → domain check (ALLOWED_EMAIL_DOMAINS)
  → hash password
  → User.create({ isVerified: false })
  → sendOtp via Resend
  → 201 "check your email"

POST /api/auth/verify-otp  { email, code }
  → check Otp doc (exists? not expired? code matches?)
  → delete Otp doc (one-time use)
  → User.isVerified = true
  → issue accessToken + refreshToken
  → 200 { accessToken, refreshToken }
```

### Email + Password login
```
POST /api/auth/login  { email, password }
  → find user (select +passwordHash)
  → reject if passwordHash === "oauth"
  → bcrypt compare
  → if !isVerified → resend OTP → 403 EMAIL_NOT_VERIFIED
  → issue token pair → 200
```

### Google OAuth
```
GET /api/auth/google
  → passport redirects to Google consent screen

GET /api/auth/google/callback
  → Google returns profile
  → domain check on profile email
  → find or create User (isVerified: true, passwordHash: "oauth")
  → issue token pair
  → redirect to FRONTEND_URL/auth/callback?accessToken=...&refreshToken=...
```

### Token refresh
```
POST /api/auth/refresh  { refreshToken }
  → find matching hashed token in Token collection
  → delete old record (rotation)
  → issue new accessToken + refreshToken
  → 200 { accessToken, refreshToken }
```

### Logout
```
POST /api/auth/logout   (Bearer accessToken required)
  → Token.deleteMany({ userId })   — revokes all refresh tokens
  → 200
```

---

## Socket Lifecycle

```
connect
  → socketAuth middleware (JWT from handshake.auth.token)
  → initSocketState(socket)
  → registerSocketEvents(io, socket)

  register-meta  { interests, age, country }   (optional, improves matching)
  find-match                                    → enqueue + _tryMatch
  match-found    (server → client)             { roomId, remoteId, initiator }
  join-room      { roomId }                    → socket joins Socket.IO room

  offer          { offer, roomId, remoteId }   → relayed to remoteId
  answer         { answer, roomId, remoteId }  → relayed to remoteId
  ice-candidate  { candidate, roomId, remoteId } → relayed to remoteId

  chat-message   { roomId, message }           → broadcast to room
  join-watch-party { partyId }
  play / pause / seek { partyId, time }        → broadcast to party

disconnect
  → cleanupMatch   (cancel queue / timeout, notify if was searching)
  → leaveRoom      (notify peer, clean room state)
  → deleteState    (remove from socket Map)
```

### Per-socket state shape (`socket.state.js`)
```js
{
  id:           string,
  user:         { id, name },
  meta:         { interests, age, country } | null,
  matchState:   { searching: boolean, matched: boolean },
  currentRoom:  string | null,
  peerId:       string | null,
  matchTimeout: TimeoutObject | null,
}
```

---

## Matchmaking (`match.service.js`)

- On `find-match`: socket marked `searching: true`, 30s timeout started
- `_tryMatch` scores all other searching sockets by shared interest count (`_interestScore`)
- Best candidate selected atomically — both marked `matched: true`, timeouts cleared
- Room ID deterministic: `room-${[socketA, socketB].sort().join("-")}`
- Both receive `match-found` with `{ roomId, remoteId, initiator: true/false }`
- On timeout: socket gets `match-timeout`, state reset to idle

---

## Security notes

- Refresh tokens are **bcrypt-hashed at rest** — DB leak cannot be used to steal sessions
- OTPs are **one-time use** and auto-expire via MongoDB TTL index
- Google OAuth accounts have `passwordHash = "oauth"` sentinel — cannot log in via password endpoint
- Domain allowlist enforced in **both** auth paths (email/password + OAuth) — no bypass possible
- WebRTC signals are room-gated — both sender and recipient must be in the same Socket.IO room
- Socket auth runs as middleware before any event handler fires
- `select: false` on `passwordHash` field — never returned in queries unless explicitly requested

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Register with email + password |
| POST | `/api/auth/verify-otp` | — | Verify OTP, get tokens |
| POST | `/api/auth/login` | — | Login, get tokens |
| POST | `/api/auth/refresh` | — | Rotate refresh token |
| POST | `/api/auth/resend-otp` | — | Resend OTP |
| POST | `/api/auth/logout` | Bearer | Revoke all refresh tokens |
| GET | `/api/auth/google` | — | Start Google OAuth |
| GET | `/api/auth/google/callback` | — | Google OAuth callback |

---

## Socket Events Reference

| Event | Direction | Payload | Description |
|---|---|---|---|
| `register-meta` | client → server | `{ interests, age, country }` | Optional pre-match metadata |
| `find-match` | client → server | — | Join matchmaking queue |
| `match-found` | server → client | `{ roomId, remoteId, initiator }` | Match successful |
| `match-timeout` | server → client | — | No match found in 30s |
| `join-room` | client → server | `{ roomId }` | Join Socket.IO room after match |
| `offer` | client → server | `{ offer, roomId, remoteId }` | WebRTC offer relay |
| `answer` | client → server | `{ answer, roomId, remoteId }` | WebRTC answer relay |
| `ice-candidate` | client → server | `{ candidate, roomId, remoteId }` | ICE candidate relay |
| `chat-message` | client → server | `{ roomId, message }` | Send chat message |
| `join-watch-party` | client → server | `{ partyId }` | Join watch party |
| `play` | client → server | `{ partyId, time }` | Sync play |
| `pause` | client → server | `{ partyId, time }` | Sync pause |
| `seek` | client → server | `{ partyId, time }` | Sync seek |
| `error` | server → client | `{ code, message }` | Validation or auth error |