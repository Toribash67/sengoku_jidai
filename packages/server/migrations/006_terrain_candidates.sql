CREATE TABLE map_terrain_candidates (
  id         TEXT PRIMARY KEY,
  terrain_id TEXT NOT NULL REFERENCES map_terrains(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  webp       BLOB NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(terrain_id, idx)
);
CREATE INDEX map_terrain_candidates_terrain_id ON map_terrain_candidates(terrain_id);
