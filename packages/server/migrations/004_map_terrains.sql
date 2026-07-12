CREATE TABLE map_terrains (
  id         TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  style_id   TEXT NOT NULL DEFAULT 'antique',
  status     TEXT NOT NULL,
  webp       BLOB,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX map_terrains_map_id ON map_terrains(map_id);

INSERT INTO map_terrains (id, map_id, name, style_id, status, webp, error, created_at, updated_at)
SELECT lower(hex(randomblob(16))), map_id, 'Terrain 1', 'antique', status, webp, error,
       updated_at, updated_at
FROM map_terrain;

DROP TABLE map_terrain;
