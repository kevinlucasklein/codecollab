-- Users
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,          -- bcrypt hash
  display_name VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(255) NOT NULL DEFAULT 'Untitled',
  owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  language    VARCHAR(50) DEFAULT 'plaintext',
  yjs_state   BYTEA,                          -- Yjs document snapshot
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user's documents listing
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
