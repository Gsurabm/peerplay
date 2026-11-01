-- =====================================================================
-- PeerPlay - Peer-to-peer competitive gaming platform
-- SQLite schema (all money stored as integer KES cents)
-- =====================================================================

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL,
  username_lower       TEXT NOT NULL UNIQUE,
  email                TEXT NOT NULL,
  email_lower         TEXT NOT NULL UNIQUE,
  phone                TEXT,
  phone_e164          TEXT,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'player',   -- player|super_admin|ops_admin|finance_admin|mod_admin
  status               TEXT NOT NULL DEFAULT 'active',   -- active|suspended|banned
  avatar_type          TEXT NOT NULL DEFAULT 'library', -- library|upload
  avatar_seed          INTEGER,
  avatar_url           TEXT,
  real_name            TEXT,
  legal_id_type        TEXT,
  legal_id_number      TEXT,
  country              TEXT NOT NULL DEFAULT 'Kenya',
  country_code         TEXT NOT NULL DEFAULT 'KE',
  city                 TEXT,
  bio                  TEXT,
  email_verified       INTEGER NOT NULL DEFAULT 0,
  phone_verified       INTEGER NOT NULL DEFAULT 0,
  identity_verified    INTEGER NOT NULL DEFAULT 0,
  two_factor_enabled   INTEGER NOT NULL DEFAULT 0,
  journey_state        TEXT NOT NULL DEFAULT 'not_started', -- not_started|in_progress|complete
  journey_matches      INTEGER NOT NULL DEFAULT 0,
  journey_wins         INTEGER NOT NULL DEFAULT 0,
  journey_losses       INTEGER NOT NULL DEFAULT 0,
  onboarding_step      INTEGER NOT NULL DEFAULT 0,
  tutorial_done        INTEGER NOT NULL DEFAULT 0,
  first_deposit_done   INTEGER NOT NULL DEFAULT 0,
  last_stake_cents     INTEGER NOT NULL DEFAULT 0,
  wins                 INTEGER NOT NULL DEFAULT 0,
  losses               INTEGER NOT NULL DEFAULT 0,
  draws                INTEGER NOT NULL DEFAULT 0,
  streak_wins          INTEGER NOT NULL DEFAULT 0,
  best_streak          INTEGER NOT NULL DEFAULT 0,
  games_played         INTEGER NOT NULL DEFAULT 0,
  total_wagered_cents  INTEGER NOT NULL DEFAULT 0,
  total_won_cents      INTEGER NOT NULL DEFAULT 0,
  biggest_win_cents    INTEGER NOT NULL DEFAULT 0,
  total_deposited_cents INTEGER NOT NULL DEFAULT 0,
  total_withdrawn_cents INTEGER NOT NULL DEFAULT 0,
  fav_game             TEXT NOT NULL DEFAULT 'tic-tac-toe',
  reputation_score     INTEGER NOT NULL DEFAULT 1000,
  risk_score           INTEGER NOT NULL DEFAULT 0,
  referral_code        TEXT UNIQUE,
  referred_by          TEXT,
  referral_source      TEXT,
  device_fingerprint   TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  last_seen_at         TEXT,
  last_login_ip        TEXT
);

CREATE TABLE IF NOT EXISTS username_history (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  username    TEXT NOT NULL,
  changed_at  TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT 'change'
);
CREATE INDEX IF NOT EXISTS idx_username_history_user ON username_history(user_id);

-- --------------------------------------------------------- verification
CREATE TABLE IF NOT EXISTS verification_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  channel      TEXT NOT NULL,     -- email|phone
  purpose      TEXT NOT NULL,     -- registration|email_verify|phone_verify|withdrawal|reset
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  verified_at  TEXT,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vtokens_user ON verification_tokens(user_id, purpose);

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  fingerprint   TEXT NOT NULL,
  platform      TEXT,
  user_agent    TEXT,
  ip            TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_fp ON devices(fingerprint);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- -------------------------------------------------------------- wallets
CREATE TABLE IF NOT EXISTS wallets (
  user_id        TEXT PRIMARY KEY,
  balance_cents  INTEGER NOT NULL DEFAULT 0,
  locked_cents   INTEGER NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'KES',
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  type          TEXT NOT NULL,  -- deposit|stake|escrow_release|win|fee|refund|penalty|withdrawal|adjustment|tutorial|referral_bonus
  direction     TEXT NOT NULL,  -- credit|debit
  amount_cents  INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'completed', -- pending|completed|failed|held
  ref_type      TEXT,
  ref_id        TEXT,
  title         TEXT NOT NULL,
  description   TEXT,
  meta          TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_ledger (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL, -- fee|penalty|withdrawal_payout|referral_payout|adjustment
  amount_cents INTEGER NOT NULL,
  ref_type     TEXT,
  ref_id       TEXT,
  description  TEXT,
  created_at   TEXT NOT NULL
);

-- ------------------------------------------------------------ payments
CREATE TABLE IF NOT EXISTS payment_intents (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  provider       TEXT NOT NULL, -- mpesa|airtel|visa|mastercard|paypal|pesalink|bank
  method         TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'KES',
  reference      TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|processing|completed|failed|reversed
  provider_ref   TEXT,
  account_hint   TEXT,
  meta           TEXT,
  error_code     TEXT,
  created_at     TEXT NOT NULL,
  completed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_intents_user ON payment_intents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawals (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL,
  fee_cents      INTEGER NOT NULL DEFAULT 0,
  net_cents      INTEGER NOT NULL,
  method         TEXT NOT NULL,
  destination    TEXT NOT NULL,
  account_name   TEXT,
  status         TEXT NOT NULL DEFAULT 'requested', -- requested|risk_hold|review|approved|processing|paid|rejected|cancelled
  risk_score     INTEGER NOT NULL DEFAULT 0,
  risk_flags     TEXT,
  requested_at   TEXT NOT NULL,
  processed_at   TEXT,
  expected_at    TEXT,
  payout_ref     TEXT,
  note           TEXT
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, requested_at DESC);

-- --------------------------------------------------------------- games
CREATE TABLE IF NOT EXISTS games (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  rules       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  min_players INTEGER NOT NULL DEFAULT 2,
  max_players INTEGER NOT NULL DEFAULT 2,
  turn_sec    INTEGER NOT NULL DEFAULT 15,
  sort_order  INTEGER NOT NULL DEFAULT 1
);

-- ------------------------------------------------------------- matches
CREATE TABLE IF NOT EXISTS matches (
  id                 TEXT PRIMARY KEY,
  game_slug          TEXT NOT NULL,
  stake_cents        INTEGER NOT NULL,
  pool_cents         INTEGER NOT NULL,
  fee_cents          INTEGER NOT NULL,
  escrow_cents       INTEGER NOT NULL,
  penalty_cents      INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL, -- pending|active|awaiting_replay|completed|cancelled
  is_tutorial        INTEGER NOT NULL DEFAULT 0,
  player_x_id        TEXT,
  player_o_id        TEXT,
  winner_id          TEXT,
  loser_id           TEXT,
  draw_count         INTEGER NOT NULL DEFAULT 0,
  board              TEXT,
  turn               TEXT,          -- x|o
  turn_deadline      TEXT,
  turn_started_at    TEXT,
  disconnect_user_id TEXT,
  disconnect_deadline TEXT,
  mode               TEXT NOT NULL DEFAULT 'ranked', -- ranked|casual|friend|tutorial
  created_by         TEXT,
  created_at         TEXT NOT NULL,
  started_at         TEXT,
  ended_at           TEXT,
  end_reason         TEXT
);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player_x_id, player_o_id);

CREATE TABLE IF NOT EXISTS match_players (
  id            TEXT PRIMARY KEY,
  match_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  game_slug     TEXT NOT NULL,
  seat          TEXT NOT NULL, -- x|o
  result        TEXT,          -- win|loss|draw|pending
  stake_cents   INTEGER NOT NULL DEFAULT 0,
  fee_cents     INTEGER NOT NULL DEFAULT 0,
  net_cents     INTEGER NOT NULL DEFAULT 0,
  moves         INTEGER NOT NULL DEFAULT 0,
  disconnected  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mp_user ON match_players(user_id);
CREATE INDEX IF NOT EXISTS idx_mp_match ON match_players(match_id);

CREATE TABLE IF NOT EXISTS match_events (
  id         TEXT PRIMARY KEY,
  match_id   TEXT NOT NULL,
  type       TEXT NOT NULL,
  actor_id   TEXT,
  payload    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_me_match ON match_events(match_id, created_at);

-- --------------------------------------------------------- matchmaking
CREATE TABLE IF NOT EXISTS queue_entries (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  game_slug    TEXT NOT NULL,
  stake_cents  INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'waiting', -- waiting|matched|expired|cancelled
  match_id     TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_entries(status, game_slug, stake_cents);

CREATE TABLE IF NOT EXISTS challenges (
  id          TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL,
  to_user_id  TEXT,
  open_link    INTEGER NOT NULL DEFAULT 0,
  game_slug   TEXT NOT NULL,
  stake_cents INTEGER NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|declined|expired|cancelled
  match_id    TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  responded_at TEXT
);

CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  channel     TEXT NOT NULL, -- sms|whatsapp|email|social|copy
  target      TEXT,
  source      TEXT,
  clicks      INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  id          TEXT PRIMARY KEY,
  inviter_id  TEXT NOT NULL,
  invitee_id  TEXT NOT NULL,
  source      TEXT,
  channel     TEXT,
  status      TEXT NOT NULL DEFAULT 'registered', -- registered|qualified|rewarded
  created_at  TEXT NOT NULL,
  qualified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(inviter_id);

-- ------------------------------------------------------------- social
CREATE TABLE IF NOT EXISTS friendships (
  id         TEXT PRIMARY KEY,
  user_a     TEXT NOT NULL,
  user_b     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|blocked
  created_at TEXT NOT NULL,
  accepted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_friends_a ON friendships(user_a);
CREATE INDEX IF NOT EXISTS idx_friends_b ON friendships(user_b);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL, -- match|wallet|social|system|security
  title      TEXT NOT NULL,
  body       TEXT,
  data       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at DESC);

-- ------------------------------------------------------- trust & safety
CREATE TABLE IF NOT EXISTS reports (
  id                TEXT PRIMARY KEY,
  reporter_id       TEXT NOT NULL,
  reported_user_id  TEXT,
  match_id          TEXT,
  reason            TEXT NOT NULL, -- draw_farming|cheating|suspicious_behaviour|disconnect_abuse|harassment|other
  details           TEXT,
  severity          TEXT NOT NULL DEFAULT 'medium', -- low|medium|high
  status            TEXT NOT NULL DEFAULT 'open', -- open|reviewing|resolved|dismissed
  resolution        TEXT,
  handled_by        TEXT,
  created_at        TEXT NOT NULL,
  resolved_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS reputation_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT,
  match_id   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repevents_user ON reputation_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS risk_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  details    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_user ON risk_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  meta        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS ranking_snapshots (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL, -- overall|daily|weekly|monthly|yearly
  period_key TEXT NOT NULL, -- e.g. 2026-10-31 / 2026-W44 / 2026-10 / 2026
  user_id    TEXT NOT NULL,
  rank       INTEGER NOT NULL,
  points     INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_lookup ON ranking_snapshots(scope, period_key, user_id);
