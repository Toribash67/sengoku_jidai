CREATE TABLE IF NOT EXISTS map_terrain (
  map_id     TEXT PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  webp       BLOB,
  error      TEXT,
  updated_at TEXT NOT NULL
);
