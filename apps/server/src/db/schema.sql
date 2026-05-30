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

-- GitHub username/login, needed to invite a user as a repo collaborator.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS github_login VARCHAR(255);

-- GitHub numeric id, used to build the noreply email GitHub uses to attribute
-- commits/co-authors to a user account.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS github_id BIGINT;

-- Tracks which users have contributed edits to a document since the last push,
-- so pushes can credit them via Co-authored-by trailers.
CREATE TABLE IF NOT EXISTS doc_contributors (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (document_id, user_id)
);

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS github_repo VARCHAR(255),
ADD COLUMN IF NOT EXISTS github_branch VARCHAR(255),
ADD COLUMN IF NOT EXISTS github_file_path VARCHAR(255),
ADD COLUMN IF NOT EXISTS base_content TEXT,
ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'none';

-- Layer 5: Persistent Sharing (grant/revoke access, OneDrive/Box style)

-- Per-document shares
CREATE TABLE IF NOT EXISTS document_shares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  shared_with UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  VARCHAR(10) NOT NULL DEFAULT 'editor', -- 'viewer' | 'editor'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, shared_with)
);

CREATE INDEX IF NOT EXISTS idx_document_shares_shared_with ON document_shares(shared_with);
CREATE INDEX IF NOT EXISTS idx_document_shares_document_id ON document_shares(document_id);

-- Per-folder (repo+branch) shares. A folder share grants access to ALL of the
-- owner's documents in that repo+branch, including ones imported later.
CREATE TABLE IF NOT EXISTS folder_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_repo   VARCHAR(255) NOT NULL,
  github_branch VARCHAR(255) NOT NULL DEFAULT '',
  shared_with   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission    VARCHAR(10) NOT NULL DEFAULT 'editor', -- 'viewer' | 'editor'
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (owner_id, github_repo, github_branch, shared_with)
);

CREATE INDEX IF NOT EXISTS idx_folder_shares_shared_with ON folder_shares(shared_with);
