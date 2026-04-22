# CampusChat — Backend

A Node.js/Express + Socket.IO backend for a real-time peer-to-peer video chat platform gated behind university email verification. Two subsystems run on a single HTTP server: a REST API for authentication and a Socket.IO server for matchmaking, WebRTC signaling, and watch-party sync.

---

## System Architecture

```
Client (Browser)
     │
     ├─── HTTP  ──► Express REST API  ──► MongoDB (Mongoose)
     │
     └─── WS   ──► Socket.IO Server
                        │
                        └── shared JWT verification (jwt.util.js)
```

The REST and Socket subsystems share JWT infrastructure — the same `verifyAccessToken()` function from `jwt.util.js` is used by both the Passport JWT strategy and the Socket.IO auth middleware.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM modules) |
| HTTP framework | Express |
| Real-time | Socket.IO |
| Database | MongoDB via Mongoose |
| Auth | JWT (jsonwebtoken) + Passport.js |
| OAuth | Google OAuth 2.0 (passport-google-oauth20) |
| Password hashing | bcrypt |
| Email | Resend API |
| Rate limiting | express-rate-limit |

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB instance (local or Atlas)
- Resend account (for OTP emails)
- Google OAuth credentials (for social login)

### Installation

```bash
git clone https://github.com/your-org/campuschat-backend.git
cd campuschat-backend
npm install
```

### Environment Variables

Create a `.env` file in the project root. The server will crash immediately on startup if any required variable is missing.

```env
# Required
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
MONGO_URI=mongodb://localhost:27017/campuschat
RESEND_API_KEY=re_xxxxxxxxxxxx
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
FRONTEND_URL=http://localhost:3000

# Optional
ALLOWED_EMAIL_DOMAINS=lnmiit.ac.in    # comma-separated; defaults to lnmiit.ac.in
ALLOWED_ORIGINS=http://localhost:3000  # Socket.IO CORS; defaults to * (lock down in prod)
APP_NAME=CampusChat                    # email sender name
PORT=5000
NODE_ENV=development
```

### Running

```bash
# Development
npm run dev

# Production
npm start
```

---

## Directory Structure

```
index.js                          ← entry point
src/
  env.validate.js                 ← fail-fast env check (runs before anything else)
  models/
    User.js                       ← Mongoose user schema
  auth/
    auth.routes.js                ← Express router
    auth.controller.js            ← HTTP handlers + global error handler
    config/
      auth.config.js              ← JWT secrets, OTP TTL, allowed domains, OAuth creds
      passport.js                 ← JWT strategy + Google OAuth strategy
      resend.js                   ← Resend email client
    middlewares/
      auth.middleware.js          ← protect / optionalAuth route guards
      rate-limit.middleware.js    ← authLimiter + otpLimiter
    models/
      otp.model.js                ← OTP document (TTL-indexed, auto-expires)
      token.model.js              ← Refresh token store (hashed, prefix-indexed)
    services/
      auth.service.js             ← register, login, verifyEmail, oauthLogin, logout, resendOtp
      otp.service.js              ← sendOtp, verifyOtp
      token.service.js            ← signAccessToken, issueRefreshToken, rotateRefreshToken
    utils/
      domain.guard.js             ← isAllowedDomain (email whitelist check)
      hash.util.js                ← hashPassword, verifyPassword, hashToken, verifyToken
      jwt.util.js                 ← signAccessToken, verifyAccessToken (shared with Socket.IO)
      otp.util.js                 ← generateOtp (crypto.randomInt)
socket/
  index.js                        ← creates Socket.IO server, applies auth middleware
  events.js                       ← registers all socket event listeners per connection
  socket.state.js                 ← in-memory per-socket state Map
  middlewares/
    auth.middleware.js            ← socketAuth (verifies JWT from handshake)
  handlers/
    webrtc.handler.js             ← offer / answer / ice-candidate relay
    chat.handler.js               ← chat-message broadcast
    watchparty.handler.js         ← join-watch-party / play / pause / seek
  services/
    match.service.js              ← enqueueMatch, cleanupMatch, registerMeta
    room.service.js               ← joinRoom, leaveRoom, isRoomOwner, pruneRoom
    watchparty.service.js         ← joinParty, updateParty, cleanupParty
  utils/
    validate.js                   ← runtime payload validators ({ ok, error })
```

---

## Boot Sequence

1. `env.validate.js` runs — crashes immediately if any required env var is missing
2. Express app + HTTP server created
3. Middleware attached: `express.json()`, `passport.initialize()`
4. `authLimiter` + auth router mounted at `/api/auth`
5. Global error handler registered (must be last Express middleware)
6. Socket.IO initialized on the same HTTP server
7. MongoDB connects → `server.listen()` called
8. `SIGTERM`/`SIGINT` handlers registered for graceful shutdown

---

## Authentication

### Email/Password Registration

```
POST /api/auth/register
  → validate email domain against whitelist
  → reject duplicate emails
  → hash password (bcrypt, 12 rounds)
  → create User (isVerified: false)
  → generate 6-digit OTP (crypto.randomInt)
  → hash OTP and store with TTL
  → send plain OTP via Resend email

POST /api/auth/verify-otp          [rate limited: 5 req / 10 min]
  → find OTP document by email
  → check expiry
  → bcrypt.compare (constant-time)
  → delete OTP (single-use)
  → mark user isVerified: true
  → issue access token (JWT, 3d) + refresh token (opaque, hashed)
  ← { accessToken } in body + refreshToken in httpOnly cookie
```

### Login

```
POST /api/auth/login
  → find user by email (with passwordHash)
  → reject if authProvider !== "local" (blocks Google-only accounts)
  → bcrypt.compare password
  → resend OTP if not yet verified
  ← { accessToken } + refreshToken cookie
```

### Token Refresh

```
POST /api/auth/refresh
  → read refreshToken from httpOnly cookie
  → extract 16-char prefix for indexed DB lookup
  → bcrypt.compare against matched candidates
  → delete old token (rotation — old token immediately invalidated)
  → issue new access token + refresh token
  ← { accessToken } + new cookie
```

### Google OAuth

```
GET /api/auth/google
  → redirect to Google consent screen

GET /api/auth/google/callback
  → validate email domain
  → find or create user (authProvider: "google", isVerified: true)
  → issue token pair
  → refreshToken → httpOnly cookie
  → accessToken → redirect to FRONTEND_URL/auth/callback#accessToken=...
```

### JWT Architecture

- **Access token** — short-lived (3d) JWT. Sent as `Authorization: Bearer <token>` on REST calls and as `socket.handshake.auth.token` for WebSocket auth.
- **Refresh token** — opaque 128-hex-char random string. Only the bcrypt hash is stored in MongoDB. The first 16 chars are stored plaintext as a lookup prefix to avoid full-collection bcrypt scans.
- **Shared verification** — both REST (Passport JWT strategy) and Socket.IO (socket auth middleware) call the same `verifyAccessToken()` from `jwt.util.js`.

---

## Socket.IO

### Connection Lifecycle

```
Client connects with JWT in handshake.auth.token
  → socketAuth middleware verifies token
  → initSocketState(socket)
  → registerSocketEvents(io, socket)

On disconnect:
  → cleanupMatch → leaveRoom → deleteState
```

### Matchmaking

```
Client emits "register-meta" → stores interests/age/country

Client emits "find-match"
  → added to queue with 30s timeout
  → scans connected sockets for candidates
  → scores by shared interests
  → two-phase claim:
      1. check candidate is still searching
      2. clear both timeouts (atomic claim)
      3. re-verify both states (race condition guard)
      4. mark both matched
  → emit "match-found" to both: { roomId, remoteId, initiator }

Both clients emit "join-room" immediately
  → socket.join(roomId)

Initiator creates RTCPeerConnection and begins signaling
```

### Room Security

Every WebRTC and chat event validates:
1. The sending socket is in the room (`socket.rooms.has(roomId)`)
2. The target socket is also in the room (`io.sockets.sockets.get(remoteId)?.rooms.has(roomId)`)

This prevents a socket from relaying messages to rooms it hasn't joined or peers it wasn't matched with.

### In-Memory State

All socket state lives in a single Map in `socket.state.js`. No other module maintains its own state Map.

```javascript
// Shape per socket
{
  id: "abc123",
  user: { id, name },
  meta: { interests, age, country },
  matchState: { searching: false, matched: false },
  currentRoom: "room-abc-def",
  peerId: "def456",
  matchTimeout: TimeoutObject | null,
}
```

---

## REST API Reference

All protected routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Register with `{ fullName, email, password }` |
| POST | `/api/auth/verify-otp` | No | Verify email with `{ email, code }` |
| POST | `/api/auth/login` | No | Login with `{ email, password }` |
| POST | `/api/auth/refresh` | No | Refresh access token (reads httpOnly cookie) |
| POST | `/api/auth/resend-otp` | No | Resend OTP to `{ email }` |
| POST | `/api/auth/logout` | Yes | Revoke refresh token + clear cookie |
| GET | `/api/auth/me` | Yes | Get authenticated user's profile |
| GET | `/api/auth/google` | No | Redirect to Google consent screen |
| GET | `/api/auth/google/callback` | No | OAuth callback → redirect with `#accessToken=...` |

### Error Response Shape

```json
{ "error": "Human readable message", "code": "MACHINE_READABLE_CODE" }
```

Common codes: `DOMAIN_NOT_ALLOWED`, `EMAIL_EXISTS`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `USE_OAUTH`, `OTP_INVALID`, `OTP_EXPIRED`, `RATE_LIMITED`, `AUTH_REQUIRED`

---

## Socket.IO Event Reference

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `register-meta` | `{ interests: string[], age?, country? }` | Set matchmaking preferences before queuing |
| `find-match` | — | Enter matchmaking queue |
| `join-room` | `{ roomId }` | Must emit immediately after receiving `match-found` |
| `offer` | `{ offer, roomId, remoteId }` | WebRTC offer (initiator only) |
| `answer` | `{ answer, remoteId, roomId }` | WebRTC answer |
| `ice-candidate` | `{ candidate, remoteId, roomId }` | ICE candidate |
| `chat-message` | `{ roomId, message: { text } }` | In-call text message (max 500 chars) |
| `join-watch-party` | `{ partyId }` | Join or create a watch party |
| `play` | `{ partyId, time }` | Host only: play at timestamp |
| `pause` | `{ partyId, time }` | Host only: pause at timestamp |
| `seek` | `{ partyId, time }` | Host only: seek to timestamp |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `match-found` | `{ roomId, remoteId, initiator: boolean }` | Match found; emit `join-room` immediately |
| `match-timeout` | — | No match found within 30 seconds |
| `offer` | `{ offer, roomId, remoteId }` | Relayed WebRTC offer |
| `answer` | `{ answer, remoteId }` | Relayed WebRTC answer |
| `ice-candidate` | `{ candidate, remoteId }` | Relayed ICE candidate |
| `chat-message` | `{ message: { text }, user }` | Broadcast chat message |
| `peer-left` | `{ remoteId }` | Peer disconnected |
| `sync-state` | `{ hostId, isHost, state: { isPlaying, currentTime } }` | Watch party initial sync |
| `state-updated` | `{ isPlaying, currentTime }` | Watch party playback change |
| `party-ended` | — | Host left; party terminated |
| `error` | `{ code, message }` | Validation or room error |

---

## Data Models

### `User`

| Field | Type | Notes |
|---|---|---|
| `email` | String | unique, lowercase |
| `username` | String | unique, sparse |
| `passwordHash` | String | `select: false`; absent for OAuth users |
| `authProvider` | `"local"` \| `"google"` | required |
| `fullName` | String | required |
| `avatar` | String | defaults to `"default-avatar.png"` |
| `university`, `major`, `graduationYear`, `bio` | String/Number | profile fields |
| `interests` | `[String]` | used for matchmaking scoring |
| `isVerified` | Boolean | false until OTP confirmed |
| `friends`, `friendRequests`, `blockedUsers` | ObjectId refs | social graph |
| `hostingPoints` | Number | gamification |
| `role` | `"user"` \| `"admin"` | |
| `lastActive` | Date | |
| `settings` | Object | mic/camera prefs, theme |

`toProfileJSON()` returns a safe public subset (no `passwordHash`).

### `Otp`

| Field | Notes |
|---|---|
| `email` | lookup key |
| `code` | bcrypt hash of the plain OTP (never stored plaintext) |
| `expiresAt` | TTL index — MongoDB auto-deletes on expiry |

### `Token` (Refresh tokens)

| Field | Notes |
|---|---|
| `userId` | ref to User |
| `token` | bcrypt hash of the raw refresh token |
| `prefix` | first 16 hex chars — plaintext, indexed for fast lookup |
| `expiresAt` | TTL index — MongoDB auto-deletes expired tokens |

---

## Key Design Decisions

- **Prefix-indexed refresh tokens** — storing the first 16 hex chars of the refresh token as a plaintext lookup key means `rotateRefreshToken` only bcrypt-compares the (usually one) token matching that prefix, avoiding full-collection scans.
- **OTP hashed at rest** — OTPs are hashed with bcrypt before storage. Verification uses `bcrypt.compare` for constant-time comparison. OTPs are deleted immediately after successful verification (single-use).
- **Single shared JWT utility** — `jwt.util.js` is the only file shared across REST and Socket subsystems. All other logic is fully isolated to its domain.
- **Single state source** — `socket.state.js` is the only module that owns in-memory socket state. No handler or service maintains its own Map.
- **Two-phase matchmaking claim** — after selecting a candidate, the match service clears both timeouts and then re-verifies both sides are still searching before marking them matched. This eliminates the race condition window between selection and commitment.
- **Fail-fast env validation** — `env.validate.js` is the very first import in `index.js`. The process exits before any server infrastructure is created if the environment is incomplete.

---

## License

MIT