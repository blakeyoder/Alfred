-- Favorite subway stations for quick access to arrivals
CREATE TABLE favorite_subway_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  stop_id TEXT NOT NULL,
  nickname TEXT, -- Optional user-friendly name like "home" or "work"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, stop_id)
);

CREATE INDEX idx_favorite_stations_user ON favorite_subway_stations(user_id);
