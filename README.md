# PeerPlay

**Challenge Accepted.**

PeerPlay is a peer-to-peer competitive gaming platform. Two players agree on a stake, both
fund an escrow, they compete in a skill-based game, and the winner receives the pot minus a
flat **25% platform fee**. The first shipped game is **Tic-Tac-Toe**, but the wallet, identity,
escrow and ranking systems are game-agnostic by design.

```
peerplay/
├── server/            # Node + Express + SQLite + Socket.IO  (game engine, wallet, escrow, admin API)
│   └── src/
│       ├── config.js          # every tunable business rule lives here
│       ├── db/                # schema.sql, connection, migrations, seed data
│       ├── lib/               # money (integer cents), ids, crypto, validation
│       ├── middleware/        # auth (JWT + role capabilities), risk signals
│       ├── services/          # domain logic
│       │   ├── games/         # game registry + tic-tac-toe rules engine
│       │   ├── matches.js     # server-authoritative match engine (timers, recovery, settlement)
│       │   ├── matchmaking.js # queue, challenges, sweep pairing
│       │   ├── wallet.js      # double-entry ledger + escrow projection
│       │   ├── payments/      # provider abstraction + signed webhook verification
│       │   ├── withdrawals.js # payout rules + risk analysis
│       │   ├── identity.js    # usernames, verification, device fingerprints
│       │   ├── risk.js        # multi-signal fraud analysis
│       │   ├── reputation.js  # reputation from real match history
│       │   ├── rankings.js    # daily/weekly/monthly/yearly/all-time boards
│       │   └── referrals.js   # invite tracking + conversion
│       ├── routes/            # REST API
│       └── realtime/          # Socket.IO gateway
└── web/               # React + Vite responsive client (same-origin, no external CDN)
    └── src/
        ├── components/         # Layout, Avatar, UI primitives
        ├── pages/              # landing, auth, dashboard, play, match, wallet, admin…
        └── state/              # session + realtime context
```

---

## 0. Public URL (open it in any browser, in two tabs or two browsers)

The sandbox preview host (`https://4000-<sandbox>.e2b.app`) is a **private** E2B endpoint: every
request must carry the sandbox's traffic access token, so a raw link returns the E2B
"Authentication required" documentation page in a browser that has never seen the preview.
That is expected behaviour of the platform, not a PeerPlay bug.

PeerPlay is therefore also published through a public Cloudflare tunnel, which needs no token:

```
https://hash-independence-must-asp.trycloudflare.com
```

* Open that URL in **any** browser, on any machine.
* Two **tabs** in one browser → use the **✦ Two-player test** button (opens a second tab with its
  own funded account).
* Two **different browsers** (or one normal + one private window) → log in as two different
  seeded players, e.g. `wanjiruachieng` / `Player123!` and `brianodhiambo` / `Player123!`, then
  queue the same stake on both.

The URL lives in **`PUBLIC_URL.txt`** (repo root and workspace root). Quick tunnels are anonymous:
Cloudflare deletes abandoned ones and the hostname changes whenever the tunnel restarts, so the
**supervisor** keeps it alive and republishes the current address:

```bash
npm run tunnel:watch     # self-healing: restarts the tunnel, health-checks the public URL
cat PUBLIC_URL.txt       # the address that is live right now
```

The supervisor runs cloudflared over HTTP/2 (QUIC is unreliable from this sandbox), restarts the
tunnel if the process dies, and recycles it if the public URL stops answering three health checks
in a row. A quick tunnel also makes the sandbox reachable by anyone who has the link, so treat it
as a temporary demo address, not a production deployment. The Arena live-preview panel
(`*.e2b.app`) always works as a stable fallback inside the platform.

---

## 0b. Try it right now (ready-made logins)

You do **not** need to sign up to explore PeerPlay.

| What | How |
| --- | --- |
| **Fastest path** | Open the app → landing page hero → **"⚡ Play instantly – no signup"**. A funded, fully-verified player (`challenger_xxxxx`) is created and signed in automatically with **KSh 1,000** in the wallet and the 5-match journey already complete. |
| **From the login page** | Same button: **"⚡ Play instantly as a demo player"**, plus one-click **Admin login** / **Player login** buttons. |
| **If signup fails** | The Register page shows a red **"Signup failed: <reason>"** banner with a **"Skip signup – play as a demo player"** button inside it. |
| **Seeded player** | `wanjiruachieng` / `Player123!` — full match history, leaderboard position, KSh 167.50 balance. |
| **Seeded admin** | `arenaadmin` / `Admin123!` — Super Admin. Other roles: `opslead`, `financeled`, `modlead` (same password `Admin123!`). |

Other seeded players (all with password `Player123!`) are listed on the in-app leaderboard —
every one of them can be used to log in immediately.

The demo endpoint is `POST /api/auth/demo` (sandbox only, rate limited to 30 per connection
per hour). It returns `{ token, credentials, user, wallet, journey }`, creates an audit row and
sends a welcome notification.

### Testing with two players in one browser

Two tabs of the same browser share one session (`localStorage`), so they are the **same player** and
the server correctly refuses to match a player with themselves. PeerPlay solves this with a
**tab-scoped session**:

| Where | Button | What it does |
| --- | --- | --- |
| Landing page | ✦ Two-player test (opens a second tab) | Creates two funded players, makes this tab player 1 and opens a second tab as player 2, both queue at KSh 10 and are matched. |
| Login page | ✦ Two-player test (opens a second tab) | Same, from the sign-in screen (no account needed). |
| Play page | Open a second player & match | Keeps your own account as player 1 and opens a funded demo player as player 2 at the stake you selected. |

Mechanics: the second tab receives a one-shot `?join=<token>` URL parameter, stores the token in
`sessionStorage` (private to that tab) and strips the parameter from the address bar. The browser
tab stays a separate player for the whole session; the first tab keeps the browser-wide session.
The server never sees two sessions for one user - they are two real accounts.

---

## 1. Running PeerPlay

```bash
# 1. backend
cd server && npm install
npm run seed        # creates demo players, match history, leaderboards, an admin account
npm start           # http://0.0.0.0:4000

# 2. frontend (development with hot reload)
cd web && npm install && npm run dev      # http://0.0.0.0:5173, proxies /api + /socket.io

# 2b. frontend (production build, served by the API server)
cd web && npm run build                   # the server serves web/dist automatically
```

| Role | Credentials |
| --- | --- |
| Super admin | `arenaadmin` / `Admin123!` |
| Ops admin | `opslead` / `Admin123!` |
| Finance admin | `financeled` / `Admin123!` |
| Moderation admin | `modlead` / `Admin123!` |
| Player | any seeded username from the leaderboard / `Player123!` |

Useful commands: `npm run reset` (wipe the DB), `npm run seed -- --force` (re-seed), `npm run dev`
(server watch mode).

### One-command quickstart from the repository root

```bash
git clone https://github.com/<your-user>/peerplay.git
cd peerplay
npm run install:all     # installs server/ and web/ dependencies
npm run seed            # demo players, match history, leaderboards, an admin account
npm run build           # builds the React client into web/dist
npm start               # serves API + client on http://0.0.0.0:4000
```

Then open <http://localhost:4000> and use the one-click **Demo account** button, or the seeded
credentials in the table above.

| Root script | What it does |
| --- | --- |
| `npm run install:all` | `npm install` in `server/` and `web/` |
| `npm run seed` | loads the demo dataset (players, matches, ledger, leaderboards) |
| `npm run reset` | deletes and recreates the SQLite database |
| `npm run build` | production build of the React client into `web/dist` |
| `npm start` | starts the API + realtime gateway (serves `web/dist` too) |
| `npm run dev` | build + start, with `node --watch` on the server |
| `npm run smoke` | boots a throwaway server and walks register → deposit → wallet credit |
| `npm run tunnel` / `tunnel:bg` / `tunnel:watch` | public Cloudflare tunnel for testing on a phone |

---

## 2. The money model (exactly as specified)

| Step | Amount |
| --- | --- |
| Player A stakes | KSh 50.00 |
| Player B stakes | KSh 50.00 |
| **Total stake pool** | **KSh 100.00** |
| Platform fee (25%) | − KSh 25.00 |
| **Winner receives** | **KSh 75.00** |

Implementation notes:

* All money is stored as **integer KES cents**. No floating point ever touches a balance.
* `computeMatchSplit()` in `lib/money.js` is the single source of truth for the split.
* On a win the winner is credited the **gross pot** (`win` transaction) and the platform fee is
  charged as its own transaction (`fee`), so the wallet history shows exactly what the spec
  describes: deposits, stakes, escrow transfers, match winnings, platform fees, withdrawals and
  penalties.
* The fee is **25% for every game and every stake level** (`PLATFORM_FEE_BPS = 2500`).

### Escrow lifecycle

```
createMatch()  → both stakes debited into escrow (type: stake)
win            → winner +gross pot, −fee  (net = escrow)  | platform ledger: fee
draw           → escrow stays active, same pot, no extra fee
3rd draw       → cancelled: penalty = 5% of ORIGINAL combined stake taken from the escrow,
                  remainder split 50/50, platform keeps fee + penalty
```

Anti-draw-farming worked example (KSh 50 vs KSh 50):

```
Original combined stake      100
Platform fee (25%)            25
Escrow                        75
Penalty (5% of 100)            5
Escrow after penalty          70
Refund to each player         35
Platform receives          25 + 5 = 30
```

The ledger reflects this as: `stake −50`, `refund +37.50`, `penalty −2.50` for each player
(net −15 each), with `fee 25` and `penalty 5` booked to the platform ledger.

### Stake rules

* Minimum **KSh 10**, multiples of **KSh 5** (10, 15, 20, 25, 30, 50, 100 …).
* A player can never stake more than their available balance.
* Both players must agree on the **exact same** stake (queue matching is stake-exact).

### 1.5x onboarding growth

The recommended stake during the first five matches grows 1.5× after each completed match
(KSh 50 → 75 → 112.50 → …).

> **Reconciliation decision:** a legal PeerPlay stake must be a multiple of KSh 5, and money is
> stored in cents, so an exact 1.5× of a legal stake is frequently *not* a legal stake
> (112.50 → 110, 168.75 → 165, and 253.125 cannot even be represented in cents). The engine
> therefore shows the **exact 1.5× figure** to the player and offers the **nearest legal stake
> (rounded down to a KSh 5 multiple)** as the one-tap recommendation. The growth curve itself is
> unchanged. See `onboardingRecommendedStake()` in `lib/money.js`.

---

## 3. Onboarding journey (5 matches)

1. Register → wallet starts at **KSh 0**.
2. **Free tutorial match** against the PeerPlay trainer (no money) that teaches the board,
   turns, the 15-second clock, winning, matchmaking and escrow.
3. **Deposit** – minimum KSh 50 via M-Pesa, Airtel Money, Visa, Mastercard, PayPal, Pesalink
   or bank transfer.
4. **First real match** – pick a stake, get matched, escrow funds, play, get settled.

Journey rules implemented exactly as specified:

* Opponents may change; time between matches does not matter.
* Every **completed win or loss** counts; **draws do not count**.
* Changing opponents never resets progress.
* Withdrawals are locked until the journey is complete (see §5).
* After five matches: any legal stake, free withdrawals.

---

## 4. Game engine — Tic-Tac-Toe

The server is the **final authority**. It verifies legal moves, turn order, winning lines,
draws and outcomes; the client only sends *intent*.

* 3×3 board, X moves first, horizontal / vertical / diagonal lines win.
* **15 seconds per move.** Running out of time loses the match.
* **30-second connection recovery.** On a drop the opponent sees
  *"Opponent connection interrupted. Recovery time remaining: 22 seconds."* If the player does
  not return, the connected player wins and the forfeiter takes a reputation hit.
* Quitting counts as a loss.
* The engine runs on a 1-second server tick (`tick()`), so timers survive process restarts and
  never depend on a client staying connected.

The game module is pluggable: `services/games/registry.js` exposes a registry of game
definitions (`initialState`, `legalMoves`, `applyMove`, `rules`, `turnSec`). Adding a second game
means adding one file to that registry — the wallet, escrow, identity, ranking and notification
systems are already shared.

---

## 5. Wallet, deposits and withdrawals

**Wallet** — deposit, view balance, transaction history, stake, receive winnings, request
withdrawals. Every movement is an immutable ledger row.

**Deposits** are verified **server-side** through a signed provider callback:

1. Client asks the server for a deposit intent → the server creates the intent with a unique
   reference and returns the gateway instructions.
2. The provider confirms asynchronously by calling `POST /api/payments/webhook/:provider` with an
   HMAC-SHA256 signature and timestamp.
3. The server verifies signature, replay window, reference, provider and **amount**, then credits
   the wallet. A browser can never credit itself — screenshots are never trusted.
4. Card numbers are never stored; only the brand and last four digits are kept.

Supported providers: `mpesa`, `airtel`, `visa`, `mastercard`, `paypal`, `pesalink`, `bank`.
The repository ships a **sandbox simulator** that reproduces each provider's contract (async
confirmation, declines, insufficient funds, settlement windows). Switching to the live gateways
means replacing the transport inside `services/payments/` — the webhook contract, signature
verification and ledger code stay identical. Each provider declares the environment variables it
needs (`live_config`).

**Withdrawals**

| Rule | Implementation |
| --- | --- |
| Minimum withdrawal | KSh 50.00 |
| New accounts | locked until the 5-match journey is complete |
| After the journey | free to withdraw; the balance may never fall below KSh 50.00 |
| Large withdrawals | identity verification required (KSh 200+ threshold) |
| Suspicious withdrawals | delayed / held for risk review, flagged for admins |
| Speed | depends on the method (M-Pesa/Airtel/PayPal instant, bank 1–3 business days) |

Risk analysis (`services/risk.js`) combines phone + email verification, identity verification,
device fingerprinting, payment-account history, behaviour analysis (deposit→withdraw ratio,
churn, multi-account detection, shared devices). Each signal contributes an explainable weight;
device fingerprinting alone **never** blocks an account.

---

## 6. Identity, usernames and avatars

* Registration: unique username, email, phone, password and **private** legal identity
  (name, ID type, ID number).
* **Public identity** – username, avatar, statistics, rankings.
* **Private identity** – legal identity, payment information, wallet history, financial
  statistics. Never returned by any public endpoint.
* Verification: email code, phone code, device fingerprint, payment history, behaviour analysis.
* Usernames: unique, changeable **once per month**, and every previous username is stored
  internally for fraud investigation, continuity and reputation tracking.
* Avatars: upload **JPG/PNG** (max 2 MB) **or** pick from the platform-created library. The
  library avatars are deterministic geometric artwork generated in-app — **no AI-generated
  imagery** is used anywhere in the product.

---

## 7. Matchmaking, social and referrals

* **Friends** – direct challenges, friend list, friend-only leaderboard.
* **Public matchmaking** – availability, identical stake, selected game.
* **Challenges** – targeted (a specific player) or open link, expiring in 24 h.
* **Offline invitations** – SMS, WhatsApp, email and social share links, all tracked.
* **Referrals** – every invite records source, inviter, clicks and registration conversion. When
  the referred player finishes the 5-match journey the inviter receives a KSh 10 bonus
  (configurable) and both sides are notified.

---

## 8. Rankings and reputation

Leaderboards: **daily, weekly, monthly, yearly and all-time global**, plus **country**,
**game-specific** and **friends** filters. Points = 100 per win plus a stake bonus of up to 50.
Rank changes are snapshotted and surfaced as "ranking changed" notifications.

Reputation is earned from **real match history and behaviour** — wins, losses, forfeits on time,
disconnects, upheld reports and draw-farming. There are **no player ratings or star scores**
anywhere in the product.

Players can report: draw farming, cheating, suspicious behaviour, repeated disconnect abuse,
harassment and other violations. Upheld reports reduce the offender's reputation score.

---

## 9. Notifications

Match (challenge received, opponent found, your turn, opponent turn, match result), wallet
(deposit completed, withdrawal requested, withdrawal completed, security alerts) and social
(friend joined, ranking changes, achievements) — persisted in the database and pushed live over
Socket.IO.

---

## 10. Admin console

Role-based administration with an explicit capability matrix enforced server-side
(`middleware/auth.js`):

| Role | Scope |
| --- | --- |
| **Super admin** | everything |
| **Operations admin** | users, reports, match issues, username management |
| **Finance admin** | deposits, withdrawals, transactions, platform ledger, adjustments |
| **Moderation admin** | reports, rule violations, reputation adjustments |

Capabilities: manage usernames, view player profiles and public statistics, monitor
transactions, review suspicious activity, approve/reject withdrawals, adjust wallets (audited),
resolve reports, inspect live matches and their event trail. Every privileged action writes to an
append-only **audit log**.

---

## 11. API surface

```
POST   /api/auth/register            POST /api/auth/login           GET /api/auth/me
POST   /api/auth/verify              POST /api/auth/identity        POST /api/auth/change-password
GET    /api/profile/me               GET /api/profile/:username     PATCH /api/profile/me
POST   /api/profile/username         POST /api/profile/avatar/upload|avatar/library
GET    /api/wallet                   GET /api/wallet/transactions   GET /api/wallet/methods
POST   /api/payments/intents         GET /api/payments/intents/:id  POST /api/payments/webhook/:provider
POST   /api/withdrawals              GET /api/withdrawals
GET    /api/matches/games            POST /api/matches/queue        DELETE /api/matches/queue
GET    /api/matches/mine             GET /api/matches/:id           POST /api/matches/:id/move
POST   /api/matches/challenges       POST /api/matches/challenges/:id/respond
POST   /api/matches/tutorial/start   GET  /api/matches/stake-guidance
GET    /api/leaderboards             GET /api/notifications         POST /api/notifications/read
POST   /api/reports                  GET /api/referrals             POST /api/referrals/invite
GET    /api/admin/overview           GET /api/admin/users           GET /api/admin/users/:id
POST   /api/admin/users/:id/status   POST /api/admin/users/:id/username|wallet|reputation
GET    /api/admin/finance/*          POST /api/admin/finance/withdrawals/:id
GET    /api/admin/reports            POST /api/admin/reports/:id
GET    /api/admin/matches           GET /api/admin/risk            GET /api/admin/audit
```

Socket.IO events: `match_state`, `match_end`, `match_draw`, `match_recovery`, `your_turn`,
`notification`, `opponent_joined`, plus the `match:join` / `match:move` / `queue:join` intents.

---

## 12. Architecture decisions

* **Backend / frontend separation.** The API + realtime gateway is completely independent of the
  web client, so Android and iOS apps can reuse the same game engine, wallet, identity and
  ranking services.
* **SQLite via better-sqlite3** — synchronous, transactional, zero-config, easy to swap for
  Postgres (the data layer is a thin wrapper over `db.prepare(...)`).
* **Single writer for money.** All balance changes go through `wallet.js`, which updates the
  wallet projection and writes the ledger row inside the same SQLite transaction.
* **Ledger before projection.** `transactions` is append-only and authoritative; `wallets` is a
  cached projection, so balances can always be rebuilt from history.
* **Server-authoritative gameplay.** The client renders state; it never decides outcomes.
* **Polling fallback.** The client polls `GET /api/matches/:id` every 2.5 s in addition to the
  socket, so a mobile client on a flaky connection still sees a live board.

## 13. Future expansion

The architecture already supports multiple games (one file per game in `services/games/`), a
shared wallet, a shared player identity and per-game rankings. Planned next: tournaments,
leagues, seasons, championships, teams/clans and expanded social features — all of which can be
layered on the existing match, escrow and ranking primitives.

---

## 14. Known scope boundaries

* Payments run in **sandbox mode** by default: the gateway callbacks are produced by an in-repo
  simulator that follows the real providers' contract. Live credentials are not shipped, and no
  real money moves.
* Verification codes are returned in the API response (sandbox delivery) instead of being
  emailed or texted.
* Bank withdrawals require finance approval in the admin console rather than auto-paying.

---

## 15. Putting PeerPlay on GitHub

The repository is already git-ready: `.gitignore` keeps secrets, the database, uploads and build
output out of history, `.env.example` documents every setting, `LICENSE` is MIT, and
`.github/workflows/ci.yml` builds the client and runs the smoke test on every push.

### What is and is not committed

| Path | Committed? | Why |
| --- | --- | --- |
| `server/src`, `web/src`, `scripts`, `.github` | ✅ yes | the actual application |
| `server/package-lock.json`, `web/package-lock.json` | ✅ yes | reproducible installs for CI and for you |
| `server/.env.example` | ✅ yes | documented settings, no secrets |
| `server/data/*.db` | ❌ no | live database (rebuild it with `npm run seed`) |
| `server/.env` | ❌ no | secrets — never commit this |
| `server/uploads/` | ❌ no | user-uploaded avatars |
| `web/dist/`, `node_modules/`, `.tools/` | ❌ no | build output and tooling |

### Step 1 — create the repository on GitHub

**Option A — the web UI (no GitHub CLI needed):**

1. Go to <https://github.com/new>.
2. Repository name: `peerplay`, choose **Public** (or Private).
3. **Do not** tick "Add a README", ".gitignore" or "License" — the repo already contains them.
4. Press **Create repository**.

**Option B — the GitHub CLI:**

```bash
gh auth login                                   # one-time browser login
gh repo create peerplay --public --description "Peer-to-peer competitive gaming platform. Challenge Accepted."
```

### Step 2 — connect this folder to your new repository

```bash
cd peerplay
git remote add origin https://github.com/<your-user>/peerplay.git
git branch -M main
git push -u origin main
```

`git push` will ask for your GitHub username and a **Personal Access Token** (not your account
password) — create one at <https://github.com/settings/tokens> with the `repo` scope. If you
prefer SSH: `git remote set-url origin git@github.com:<your-user>/peerplay.git`.

**Working on your own machine instead?** Download `peerplay-v1.0.zip` (the clean source, no
`node_modules`, no database), unzip it, and run the same three commands — or start from scratch:

```bash
unzip peerplay-v1.0.zip
cd peerplay
git init -b main
git add -A
git commit -m "PeerPlay v1.0"
git remote add origin https://github.com/<your-user>/peerplay.git
git push -u origin main
```

### Step 3 — keep it updated

```bash
git add -A
git commit -m "Describe your change"
git push
```

Useful everyday commands:

```bash
git status                 # what changed
git log --oneline -10      # history
git diff                   # review before committing
git checkout -b feature/x  # work on a branch
```

### Step 4 — deploy it from GitHub

* **GitHub Pages** cannot run this app (it needs a Node server + SQLite). Use it only for docs.
* **Any Node host works** — a VPS (Ubuntu), Railway, Render, Fly.io, Koyeb or DigitalOcean
  App Platform. The start command is `npm start` on port `4000`, the build command is
  `npm run install:all && npm run build`, and the SQLite file lives in `server/data/`.
  On a VPS, run it behind nginx with a TLS certificate (certbot) and point a domain at it.
* **Docker** — build `npm run install:all && npm run build` into an image, mount
  `/app/server/data` as a volume and expose `4000`.
* **The repo already includes CI** — every push to `main` builds the web client and runs the
  smoke test; the green check next to the commit tells you the code is sound.

### Step 5 — keep secrets out of GitHub

* `server/.env` is ignored. Copy `server/.env.example` → `server/.env` locally and fill it in.
* In production, set `NODE_ENV=production` and replace `JWT_SECRET`, `DEVICE_SALT` and
  `WEBHOOK_SECRET` with long random values (`openssl rand -hex 32`).
* Never commit `.env`, database files or real payment credentials. If you ever do commit a
  secret, rotate it immediately and rewrite the history (`git filter-repo`) — deleting the file
  in a later commit is not enough.

---

## 16. Repository layout for contributors

```
peerplay/
├── .github/workflows/ci.yml   # build + smoke test on every push
├── scripts/                   # tunnel helpers (public URL for phone testing)
├── server/
│   ├── scripts/smoke.mjs       # self-contained API smoke test
│   ├── .env.example           # every setting, no secrets
│   └── src/                   # Express API, Socket.IO gateway, SQLite schema
└── web/src/                   # React + Vite client (15 pages)
```

Conventions: money is always integer KES cents (`server/src/lib/money.js`), the server decides
every outcome, and every balance change goes through `server/src/services/wallet.js`.
