# Backend Context & Architecture Reference

## Table of Contents
1. [System Overview](#system-overview)
2. [Tech Stack](#tech-stack)
3. [Startup & Entry Point](#startup--entry-point)
4. [Directory Structure](#directory-structure)
5. [Authentication System](#authentication-system)
6. [Socket.IO System](#socketio-system)
7. [Data Models](#data-models)
8. [File-by-File Reference](#file-by-file-reference)
9. [Frontend Contract](#frontend-contract)
10. [Environment Variables](#environment-variables)
11. [Dependency Graph](#dependency-graph)

---

## System Overview

This is a **Node.js/Express + Socket.IO** backend for a real-time peer-to-peer video chat platform (like Omegle, but for a university audience). It has two major subsystems running on a single HTTP server:

1. **REST API** (`/api/auth/*`) — handles user registration, email OTP verification, login, Google OAuth, and JWT token management.
2. **Socket.IO server** — handles real-time matchmaking, WebRTC signaling (offer/answer/ICE), in-call chat, and watch-party sync.

The two systems share the same JWT infrastructure: the REST API issues JWTs; the Socket.IO auth middleware verifies them using the same secret.

```
Client (Browser)
     │
     ├─── HTTP  ──► Express REST API  ──► MongoDB (Mongoose)
     │                                         │
     └─── WS   ──► Socket.IO Server            │
                        │                      │
                        └── reads User model ──┘
```

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
| Env validation | Custom fail-fast script |

---

## Startup & Entry Point

### `index.js`

**First thing it does:** imports `./src/env.validate.js` — this immediately crashes the process if any required environment variable is missing. Nothing else runs until env is clean.

**Boot sequence:**
1. Validate env vars
2. Create Express app + HTTP server
3. Attach middleware: `express.json()`, `passport.initialize()`
4. Mount routes: `authLimiter` + `authRouter` at `/api/auth`
5. Mount error handler (must be last Express middleware)
6. Init Socket.IO on the same HTTP server
7. Connect to MongoDB → only then call `server.listen()`
8. Register SIGTERM/SIGINT handlers for graceful shutdown

**Depends on:** `env.validate.js`, `passport.js`, `auth.routes.js`, `auth.controller.js` (for error handler), `socket/index.js`, `rate-limit.middleware.js`

---

## Directory Structure

```
index.js                          ← entry point
src/
  env.validate.js                 ← fail-fast env check
  models/
    User.js                       ← Mongoose user schema
  auth/
    auth.routes.js                ← Express router
    auth.controller.js            ← HTTP request handlers
    config/
      auth.config.js              ← JWT secrets, OTP TTL, allowed domains, Google OAuth creds
      passport.js                 ← JWT strategy + Google OAuth strategy
      resend.js                   ← email sender (Resend API)
    middlewares/
      auth.middleware.js          ← protect / optionalAuth route guards
      rate-limit.middleware.js    ← authLimiter + otpLimiter
    models/
      otp.model.js                ← OTP document (auto-expires via TTL index)
      token.model.js              ← Refresh token store (hashed, prefix-indexed)
    services/
      auth.service.js             ← register, login, verifyEmail, oauthLogin, logout, resendOtp
      otp.service.js              ← sendOtp, verifyOtp
      token.service.js            ← signAccessToken, issueRefreshToken, rotateRefreshToken, revokeAllTokens
    utils/
      domain.guard.js             ← isAllowedDomain (whitelist check)
      hash.util.js                ← hashPassword, verifyPassword, hashToken, verifyToken
      jwt.util.js                 ← signAccessToken, verifyAccessToken (shared between REST + Socket)
      otp.util.js                 ← generateOtp (crypto.randomInt)
socket/
  index.js                        ← creates Socket.IO server, applies auth middleware
  events.js                       ← registers all socket event listeners
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
    validate.js                   ← runtime payload validators (return {ok, error})
```

---

## Authentication System

### Registration & Email Verification Flow

```
POST /api/auth/register
  → auth.service.register()
      → isAllowedDomain() — check email whitelist
      → User.findOne()    — reject duplicates
      → hashPassword()    — bcrypt, 12 rounds
      → User.create()     — authProvider: "local", isVerified: false
      → sendOtp()
          → generateOtp() — crypto.randomInt 6-digit
          → bcrypt.hash(code) — hash stored, plain sent
          → Otp.create()
          → sendOtpEmail() via Resend

POST /api/auth/verify-otp  [rate limited: 5 req / 10 min]
  → auth.service.verifyEmail()
      → verifyOtp()
          → Otp.findOne()
          → check expiresAt
          → bcrypt.compare() — timing-safe
          → Otp.deleteOne() — one-time use
      → User.findOneAndUpdate() — isVerified: true
      → _issueTokenPair()
          → signAccessToken() — JWT, 3d
          → issueRefreshToken() — random 64 bytes, hashed, stored with prefix
  ← { accessToken } in JSON body
  ← refreshToken in httpOnly cookie
```

### Login Flow

```
POST /api/auth/login
  → auth.service.login()
      → User.findOne().select("+passwordHash")
      → check authProvider === "local" (blocks Google-only accounts)
      → verifyPassword() — bcrypt.compare
      → check isVerified (resends OTP if not)
      → _issueTokenPair()
  ← { accessToken } + refreshToken cookie
```

### Token Refresh Flow

```
POST /api/auth/refresh
  → reads refreshToken from cookie OR req.body
  → rotateRefreshToken(raw)
      → extract prefix (first 16 hex chars)
      → Token.find({ prefix, expiresAt: { $gt: now } }) — fast index hit
      → bcrypt.compare against each candidate (usually just 1)
      → matched.deleteOne() — rotation: old token is revoked
      → issue new accessToken + refreshToken
  ← { accessToken } + new refreshToken cookie
```

### Google OAuth Flow

```
GET /api/auth/google
  → passport redirects to Google consent screen

GET /api/auth/google/callback
  → Google redirects back with code
  → passport-google-oauth20 strategy:
      → validate email domain
      → User.findOne({ email })
          → if exists: update isVerified + authProvider if needed
          → if new: User.create({ authProvider: "google", isVerified: true })
  → googleCallback controller:
      → oauthLogin() → _issueTokenPair()
      → refreshToken → httpOnly cookie
      → accessToken → redirect fragment: /auth/callback#accessToken=...
```

### JWT Architecture

- **Access token:** Short-lived (3d) JWT signed with `JWT_SECRET`. Carried as `Authorization: Bearer <token>` on REST calls. Passed as `socket.handshake.auth.token` for WebSocket auth.
- **Refresh token:** Opaque 128-hex-char random string. Only the bcrypt hash is stored in MongoDB. The first 16 chars (prefix) are stored plaintext as a lookup index to avoid full-collection bcrypt scans.
- **Shared verification:** Both REST (`passport.js` JWT strategy) and Socket.IO (`socket/middlewares/auth.middleware.js`) call `verifyAccessToken()` from `jwt.util.js` — same logic, same secret, no duplication.

---

## Socket.IO System

### Connection Lifecycle

```
Client connects (sends JWT in handshake.auth.token)
  → socketAuth middleware verifies JWT
  → initSocketState(socket) — initializes state entry
  → registerSocketEvents(io, socket)

Events registered:
  "register-meta"     → stores interests/age/country for matching
  "find-match"        → enqueueMatch()
  "join-room"         → joinRoom() after match-found
  offer/answer/ice    → WebRTC relay (webrtcHandler)
  "chat-message"      → broadcast to room (chatHandler)
  "join-watch-party"  → watchPartyHandler
  play/pause/seek     → watchPartyHandler
  "disconnect"        → cleanupMatch → leaveRoom → deleteState
```

### Matchmaking Flow

```
Client emits "find-match"
  → enqueueMatch(socket, io)
      → setState: searching=true
      → setTimeout(30s) — emits "match-timeout" if no match found
      → _tryMatch(socket, io)
          → getAllSearching() — scan state Map for searching sockets
          → score candidates by shared interests (_interestScore)
          → pick best candidate
          → check candidate still searching (Step 1)
          → clear both timeouts (Step 2 — claim window)
          → re-check both states (Step 3 — race condition guard)
          → setState both: matched=true (Step 4 — atomic)
          → build roomId = "room-" + sorted([a,b]).join("-")
          → emit "match-found" to both with { roomId, remoteId, initiator }

Client receives "match-found"
  → immediately emits "join-room" with { roomId }
  → server: joinRoom() — socket.join(roomId), sets roomOwner

Initiator client starts WebRTC:
  → emits "offer" → server relays to remoteId (only if both in same room)
  → remote emits "answer" → relayed back
  → both emit "ice-candidate" → relayed
```

### Room Security

Every WebRTC/chat event checks:
1. `socket.rooms.has(roomId)` — sender is actually in the room
2. `io.sockets.sockets.get(remoteId)?.rooms.has(roomId)` — target is also in the room

This prevents spoofing: a socket can't relay messages to a room it hasn't joined, and can't send to a peer it wasn't matched with.

### State Management (`socket.state.js`)

Single in-memory Map: `socketId → state`. Shape:

```javascript
{
  id: "abc123",
  user: { id, name },          // from JWT payload
  meta: { interests, age, country },
  matchState: { searching: false, matched: false },
  currentRoom: "room-abc-def",
  peerId: "def456",
  matchTimeout: TimeoutObject | null,
}
```

`setState()` does a shallow merge with special handling for `matchState` (deep merges it). All services import `getState`/`setState` — no module-level Maps elsewhere.

### Watch Party

- Party state lives in `watchparty.service.js` in-memory Map: `partyId → { hostId, state }`
- Only the host (first to join) can `play`, `pause`, `seek`
- On join, server emits `sync-state` with current playback position
- Room ownership for party rooms tracked in `room.service.js` `roomOwners` Map

---

## Data Models

### `User` (src/models/User.js)

| Field | Type | Notes |
|---|---|---|
| email | String | unique, lowercase, required |
| username | String | unique, sparse (optional) |
| passwordHash | String | select: false; absent for OAuth users |
| authProvider | "local" \| "google" | required; replaces old `passwordHash: "oauth"` sentinel |
| fullName | String | required |
| avatar | String | defaults to "default-avatar.png" |
| university, major, graduationYear, bio | String/Number | profile fields |
| interests | [String] | used for matchmaking scoring |
| isVerified | Boolean | false until OTP confirmed |
| friends, friendRequests, blockedUsers | ObjectId refs | social graph |
| hostingPoints | Number | gamification |
| role | "user" \| "admin" | |
| lastActive | Date | |
| settings | Object | mic/camera prefs, theme |

`toProfileJSON()` returns a safe public subset (no passwordHash).

### `Otp` (src/auth/models/otp.model.js)

| Field | Notes |
|---|---|
| email | lookup key |
| code | **bcrypt hash** of the plain OTP (never stored plaintext) |
| expiresAt | TTL index: MongoDB auto-deletes when expired |

### `Token` (src/auth/models/token.model.js)

| Field | Notes |
|---|---|
| userId | ref to User |
| token | bcrypt hash of the raw refresh token |
| prefix | first 16 hex chars — plaintext, indexed for fast lookup |
| expiresAt | TTL index: MongoDB auto-deletes expired tokens |

Indexes: `{ expiresAt: 1 }` (TTL), `{ userId: 1 }`, `{ prefix: 1 }`.

---

## File-by-File Reference

### `src/env.validate.js`
- **Purpose:** Fail-fast guard. Reads `process.env` and exits if any required key is missing.
- **Expects from environment:** `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MONGO_URI`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `FRONTEND_URL`
- **Depended on by:** `index.js` (imported first)

### `src/auth/config/auth.config.js`
- **Purpose:** Single source of truth for auth configuration values.
- **Exports:** `authConfig` object with `accessToken`, `refreshToken`, `otp`, `allowedDomains`, `google` fields.
- **Expects from env:** `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ALLOWED_EMAIL_DOMAINS` (comma-separated, defaults to `lnmiit.ac.in`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- **Depended on by:** `passport.js`, `token.service.js`, `otp.service.js`, `domain.guard.js`, `jwt.util.js`

### `src/auth/config/passport.js`
- **Purpose:** Configures and registers two Passport strategies.
  - **JWT strategy:** Extracts Bearer token, verifies it, loads User from DB (without passwordHash).
  - **Google strategy:** Handles OAuth callback — finds or creates user, enforces domain whitelist, sets `authProvider: "google"`.
- **Expects from:** `auth.config.js` (credentials), `User` model, `domain.guard.js`
- **Depended on by:** `auth.routes.js` (Google routes), `auth.middleware.js` (JWT protect), `index.js` (passport.initialize)

### `src/auth/config/resend.js`
- **Purpose:** Initializes the Resend client and exports `sendOtpEmail()`.
- **Expects from env:** `RESEND_API_KEY`, `APP_NAME`
- **Depended on by:** `otp.service.js`

### `src/auth/auth.routes.js`
- **Purpose:** Express Router. Maps HTTP methods+paths to controller functions. Applies `otpLimiter` to OTP routes.
- **Routes:**
  - `POST /register`, `POST /verify-otp`, `POST /login`, `POST /refresh`, `POST /resend-otp`, `POST /logout`, `GET /me`
  - `GET /google`, `GET /google/callback`, `GET /google/failed`
- **Depended on by:** `index.js`

### `src/auth/auth.controller.js`
- **Purpose:** HTTP layer — reads req, calls services, writes res. Also exports `errorHandler`.
- **Key behaviors:**
  - Refresh token always set as httpOnly cookie (never in response body)
  - `googleCallback`: refresh token → cookie; access token → URL fragment (`#accessToken=...`)
  - `ERROR_STATUS` map converts service error codes to HTTP status codes
- **Depended on by:** `auth.routes.js`, `index.js` (errorHandler)

### `src/auth/middlewares/auth.middleware.js`
- **Purpose:** `protect` — blocks unauthenticated requests (401). `optionalAuth` — attaches user if token present but doesn't block.
- **Depends on:** `passport.js` (JWT strategy)
- **Depended on by:** `auth.routes.js` (`/logout`, `/me`)

### `src/auth/middlewares/rate-limit.middleware.js`
- **Purpose:** Two limiters — `authLimiter` (60 req/15min, applied to all `/api/auth`) and `otpLimiter` (5 req/10min, applied to OTP endpoints).
- **Depended on by:** `index.js` (authLimiter), `auth.routes.js` (otpLimiter)

### `src/auth/services/auth.service.js`
- **Purpose:** Core auth business logic. Orchestrates models, utils, and other services.
- **Exports:** `register`, `verifyEmail`, `login`, `oauthLogin`, `logout`, `resendOtp`
- **Depends on:** `User` model, `hash.util.js`, `domain.guard.js`, `otp.service.js`, `token.service.js`
- **Depended on by:** `auth.controller.js`

### `src/auth/services/otp.service.js`
- **Purpose:** Generates, hashes, stores, sends, and verifies OTPs.
- **Security:** OTP is hashed with bcrypt before storage. Verification uses `bcrypt.compare` (constant-time). OTPs are single-use (deleted after verify).
- **Depends on:** `Otp` model, `otp.util.js`, `resend.js`, `auth.config.js`, `bcrypt`
- **Depended on by:** `auth.service.js`

### `src/auth/services/token.service.js`
- **Purpose:** Manages refresh tokens (issue, rotate, revoke). Also re-exports `signAccessToken`.
- **Optimization:** Prefix-indexed lookup so `rotateRefreshToken` only bcrypt-compares tokens sharing the same 16-char prefix (avoids full-collection scan).
- **Depends on:** `Token` model, `hash.util.js`, `auth.config.js`, `jsonwebtoken`, `crypto`
- **Depended on by:** `auth.service.js`, `auth.controller.js` (refresh)

### `src/auth/utils/domain.guard.js`
- **Purpose:** `isAllowedDomain(email)` — checks email domain against `authConfig.allowedDomains`.
- **Depended on by:** `auth.service.js`, `passport.js`

### `src/auth/utils/hash.util.js`
- **Purpose:** bcrypt wrappers — `hashPassword` (12 rounds), `verifyPassword`, `hashToken` (10 rounds), `verifyToken`.
- **Depended on by:** `auth.service.js`, `token.service.js`, `otp.service.js`

### `src/auth/utils/jwt.util.js`
- **Purpose:** Shared JWT sign/verify. Used by both REST (via passport) and Socket.IO auth middleware.
- **Exports:** `signAccessToken`, `verifyAccessToken`
- **Depended on by:** `token.service.js`, `socket/middlewares/auth.middleware.js`

### `src/auth/utils/otp.util.js`
- **Purpose:** `generateOtp()` — cryptographically random 6-digit string using `crypto.randomInt`.
- **Depended on by:** `otp.service.js`

### `socket/index.js`
- **Purpose:** Creates Socket.IO server with CORS config, applies `socketAuth` middleware, initializes state and registers events per connection.
- **Expects from env:** `ALLOWED_ORIGINS`
- **Depended on by:** `index.js`

### `socket/middlewares/auth.middleware.js`
- **Purpose:** `socketAuth` — verifies JWT from `socket.handshake.auth.token`. In development, bypasses auth and sets a dev user.
- **Depends on:** `jwt.util.js`
- **Depended on by:** `socket/index.js`

### `socket/socket.state.js`
- **Purpose:** In-memory Map of all connected sockets' state. Single source of truth for matchmaking and room state.
- **Exports:** `initSocketState`, `getState`, `setState`, `deleteState`, `getAllSearching`
- **Depended on by:** `match.service.js`, `room.service.js`, `events.js`

### `socket/events.js`
- **Purpose:** Registers all event listeners on a socket in lifecycle order. Orchestrates handler modules.
- **Depends on:** `match.service.js`, `room.service.js`, `socket.state.js`, all handlers, `validate.js`
- **Depended on by:** `socket/index.js`

### `socket/services/match.service.js`
- **Purpose:** Matchmaking engine. Queues sockets, scores candidates by shared interests, resolves race conditions with a two-phase check-then-claim pattern.
- **Race condition guard:** After clearing timeouts (the "claim"), re-verifies both sides still searching before marking matched.
- **Exports:** `enqueueMatch`, `cleanupMatch`, `registerMeta`
- **Depends on:** `socket.state.js`
- **Depended on by:** `events.js`

### `socket/services/room.service.js`
- **Purpose:** Manages Socket.IO room join/leave, room ownership, and cleanup on disconnect.
- **Security:** Rejects joins if `currentRoom` doesn't match, rejects if room is full (>2).
- **Exports:** `joinRoom`, `leaveRoom`, `isRoomOwner`, `pruneRoom`
- **Depends on:** `socket.state.js`, `watchparty.service.js` (for party room cleanup)
- **Depended on by:** `events.js`

### `socket/services/watchparty.service.js`
- **Purpose:** In-memory watch party state. Tracks host and playback state per party room. Only the host can update state.
- **Exports:** `joinParty`, `updateParty`, `cleanupParty`
- **Depended on by:** `watchparty.handler.js`, `room.service.js`

### `socket/handlers/webrtc.handler.js`
- **Purpose:** Relays WebRTC signaling (offer, answer, ice-candidate) between matched peers. Validates both peers are in the same room before relaying.
- **Depended on by:** `events.js`

### `socket/handlers/chat.handler.js`
- **Purpose:** Receives `chat-message`, validates payload, broadcasts to room.
- **Depends on:** `validate.js`
- **Depended on by:** `events.js`

### `socket/handlers/watchparty.handler.js`
- **Purpose:** Handles watch party socket events. Uses `guard()` to validate room membership and partyId before acting.
- **Depends on:** `watchparty.service.js`, `validate.js`
- **Depended on by:** `events.js`

### `socket/utils/validate.js`
- **Purpose:** Runtime validators for socket payloads. All return `{ ok: boolean, error: string | null }` — never throw.
- **Exports:** `validateMeta`, `validateTime`, `validateMessage`, `validateRoomId`, `validatePartyId`
- **Depended on by:** `events.js`, `chat.handler.js`, `watchparty.handler.js`

---

## Frontend Contract

### REST API

#### Headers
All protected routes require: `Authorization: Bearer <accessToken>`

#### Endpoints

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/auth/register` | No | `{ fullName, email, password }` | `201 { message }` |
| POST | `/api/auth/verify-otp` | No | `{ email, code }` | `{ accessToken }` + cookie |
| POST | `/api/auth/login` | No | `{ email, password }` | `{ accessToken }` + cookie |
| POST | `/api/auth/refresh` | No | (reads cookie automatically) | `{ accessToken }` + new cookie |
| POST | `/api/auth/resend-otp` | No | `{ email }` | `{ message }` |
| POST | `/api/auth/logout` | Yes | — | `{ message }` |
| GET | `/api/auth/me` | Yes | — | User profile JSON |
| GET | `/api/auth/google` | No | — | Redirects to Google |
| GET | `/api/auth/google/callback` | No | — | Redirects to `FRONTEND_URL/auth/callback#accessToken=...` |

#### Token Handling
- **Access token:** Store in memory (not localStorage). Send as `Authorization: Bearer` header.
- **Refresh token:** Stored automatically in httpOnly cookie by the server. Frontend never sees it — just call `/refresh` when the access token expires.
- **Google OAuth:** After redirect to `/auth/callback`, read `accessToken` from `window.location.hash`.

#### Error Response Shape
```json
{ "error": "Human readable message", "code": "MACHINE_READABLE_CODE" }
```

Common codes: `DOMAIN_NOT_ALLOWED`, `EMAIL_EXISTS`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `USE_OAUTH`, `OTP_INVALID`, `OTP_EXPIRED`, `RATE_LIMITED`, `AUTH_REQUIRED`

---

### Socket.IO API

#### Connection
```javascript
const socket = io(SERVER_URL, {
  auth: { token: "<accessToken>" }
});
```

#### Event Reference

**Client → Server:**

| Event | Payload | Description |
|---|---|---|
| `register-meta` | `{ interests: string[], age?: number, country?: string }` | Set matchmaking preferences. Call before `find-match`. |
| `find-match` | — | Enter matchmaking queue. |
| `join-room` | `{ roomId: string }` | **Must** emit immediately after receiving `match-found`. |
| `offer` | `{ offer, roomId, remoteId }` | Send WebRTC offer (initiator only). |
| `answer` | `{ answer, remoteId, roomId }` | Send WebRTC answer. |
| `ice-candidate` | `{ candidate, remoteId, roomId }` | Send ICE candidate. |
| `chat-message` | `{ roomId, message: { text: string } }` | Send chat message (max 500 chars). |
| `join-watch-party` | `{ partyId: string }` | Join or create a watch party. |
| `play` | `{ partyId, time: number }` | Host only: play at timestamp. |
| `pause` | `{ partyId, time: number }` | Host only: pause at timestamp. |
| `seek` | `{ partyId, time: number }` | Host only: seek to timestamp. |

**Server → Client:**

| Event | Payload | Description |
|---|---|---|
| `match-found` | `{ roomId, remoteId, initiator: boolean }` | Match found. Emit `join-room` immediately. |
| `match-timeout` | — | No match found in 30 seconds. |
| `offer` | `{ offer, roomId, remoteId }` | Relayed WebRTC offer from peer. |
| `answer` | `{ answer, remoteId }` | Relayed WebRTC answer from peer. |
| `ice-candidate` | `{ candidate, remoteId }` | Relayed ICE candidate from peer. |
| `chat-message` | `{ message: { text }, user }` | Broadcast chat message. |
| `peer-left` | `{ remoteId }` | Peer disconnected from room. |
| `sync-state` | `{ hostId, isHost, state: { isPlaying, currentTime } }` | Watch party initial sync on join. |
| `state-updated` | `{ isPlaying, currentTime }` | Watch party state changed. |
| `party-ended` | — | Host left watch party. |
| `room-owner-changed` | `{ ownerId }` | Room ownership transferred. |
| `error` | `{ code, message }` | Validation or room error. |

#### WebRTC Flow (client-side responsibility)
1. Both clients receive `match-found` → both emit `join-room`
2. Client with `initiator: true` creates `RTCPeerConnection`, creates offer, emits `offer`
3. Other client receives `offer`, creates answer, emits `answer`
4. Both exchange `ice-candidate` events as they're discovered

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Access token signing secret |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret (currently unused directly — tokens are opaque — but validated at startup) |
| `MONGO_URI` | Yes | MongoDB connection string |
| `RESEND_API_KEY` | Yes | Resend email API key |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | Yes | Full URL for OAuth callback, e.g. `http://localhost:5000/api/auth/google/callback` |
| `FRONTEND_URL` | Yes | Frontend origin, e.g. `http://localhost:3000`. Used for OAuth redirect and cookie `secure` flag. |
| `ALLOWED_EMAIL_DOMAINS` | No | Comma-separated list of allowed email domains. Defaults to `lnmiit.ac.in`. |
| `ALLOWED_ORIGINS` | No | Socket.IO CORS origin. Defaults to `*` (lock down in production). |
| `APP_NAME` | No | Displayed as email sender name. Defaults to `App`. |
| `PORT` | No | Server port. Defaults to `5000`. |
| `NODE_ENV` | No | Set to `production` for secure cookies + socket auth enforcement. |

---

## Dependency Graph

```
index.js
  ├── src/env.validate.js
  ├── src/auth/config/passport.js
  │     ├── src/auth/config/auth.config.js
  │     ├── src/models/User.js
  │     └── src/auth/utils/domain.guard.js
  ├── src/auth/auth.routes.js
  │     ├── src/auth/auth.controller.js
  │     │     ├── src/auth/services/auth.service.js
  │     │     │     ├── src/models/User.js
  │     │     │     ├── src/auth/utils/hash.util.js
  │     │     │     ├── src/auth/utils/domain.guard.js
  │     │     │     ├── src/auth/services/otp.service.js
  │     │     │     │     ├── src/auth/models/otp.model.js
  │     │     │     │     ├── src/auth/utils/otp.util.js
  │     │     │     │     └── src/auth/config/resend.js
  │     │     │     └── src/auth/services/token.service.js
  │     │     │           ├── src/auth/models/token.model.js
  │     │     │           ├── src/auth/utils/hash.util.js
  │     │     │           └── src/auth/utils/jwt.util.js
  │     │     └── src/auth/services/token.service.js (refresh route)
  │     ├── src/auth/middlewares/auth.middleware.js
  │     └── src/auth/middlewares/rate-limit.middleware.js
  └── socket/index.js
        ├── socket/middlewares/auth.middleware.js
        │     └── src/auth/utils/jwt.util.js   ← shared with REST
        └── socket/events.js
              ├── socket/socket.state.js
              ├── socket/services/match.service.js
              │     └── socket/socket.state.js
              ├── socket/services/room.service.js
              │     ├── socket/socket.state.js
              │     └── socket/services/watchparty.service.js
              ├── socket/handlers/webrtc.handler.js
              ├── socket/handlers/chat.handler.js
              │     └── socket/utils/validate.js
              └── socket/handlers/watchparty.handler.js
                    ├── socket/services/watchparty.service.js
                    └── socket/utils/validate.js
```

### Key Shared Boundaries

- `jwt.util.js` is the only file shared across the REST and Socket subsystems. Everything else is isolated to its domain.
- `socket.state.js` is the only source of truth for in-memory socket state — no other module maintains its own state Map.
- `auth.config.js` is the only place configuration values live — no hardcoded secrets or durations in service files.
- `validate.js` is the only place socket payload validation lives — handlers don't implement their own checks inline.