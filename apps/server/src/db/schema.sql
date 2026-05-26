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
  review_status VARCHAR(50) DEFAULT 'none',
  yjs_state   BYTEA,                          -- Yjs document snapshot
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user's documents listing
CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON documents(owner_id);

-- Layer 2: Comments & Code Review

CREATE TABLE IF NOT EXISTS comment_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comment_threads_document_id ON comment_threads(document_id);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_thread_id ON comments(thread_id);

-- Layer 4: GitHub Integration

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS github_access_token VARCHAR(255);

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS github_repo VARCHAR(255),
ADD COLUMN IF NOT EXISTS github_branch VARCHAR(255),
ADD COLUMN IF NOT EXISTS github_file_path VARCHAR(255),
ADD COLUMN IF NOT EXISTS base_content TEXT;
