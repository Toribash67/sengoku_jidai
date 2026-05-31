CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_seats (
  game_id TEXT NOT NULL,
  seat TEXT NOT NULL,
  player_id TEXT NOT NULL,
  status TEXT NOT NULL,
  display_name TEXT,
  claimed_at TEXT,
  last_seen_at TEXT,
  PRIMARY KEY (game_id, seat),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  game_id TEXT NOT NULL,
  seat TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (game_id, seat) REFERENCES game_seats(game_id, seat) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_snapshots (
  game_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, revision),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_command_attempts (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  seat TEXT NOT NULL,
  client_command_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  accepted_revision INTEGER,
  command_json TEXT NOT NULL,
  result_status TEXT NOT NULL,
  rejection_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_game_command_client_id
  ON game_command_attempts(game_id, seat, client_command_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_game_command_accepted_revision
  ON game_command_attempts(game_id, accepted_revision)
  WHERE accepted_revision IS NOT NULL;

CREATE TABLE IF NOT EXISTS game_events (
  game_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, revision, sequence),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
