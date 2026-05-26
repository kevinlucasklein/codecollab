// CodeCollab — Shared Types
// Used by both frontend and backend

// User & Auth

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  githubAccessToken?: string;
}

export interface AuthPayload {
  token: string;
  user: User;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

// Documents

export interface Document {
  id: string;
  title: string;
  ownerId: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  githubRepo?: string;
  githubBranch?: string;
  githubFilePath?: string;
  baseContent?: string;
  ownerDisplayName?: string;
  reviewStatus?: 'none' | 'pending' | 'approved' | 'changes_requested';
}

export interface CreateDocumentInput {
  title?: string;
  language?: string;
}

export interface UpdateDocumentInput {
  title?: string;
  language?: string;
}

// WebSocket Events

export interface ServerToClientEvents {
  "sync:update": (update: Uint8Array) => void;
  "sync:awareness": (update: Uint8Array) => void;
  "user:joined": (user: { id: string; displayName: string; color: string }) => void;
  "user:left": (userId: string) => void;
  "doc:loaded": (state: Uint8Array) => void;
  "doc:error": (message: string) => void;
  "comment:thread_created": (thread: CommentThread) => void;
  "comment:added": (comment: Comment) => void;
  "comment:resolved": (threadId: string) => void;
  "document:renamed": (newTitle: string) => void;
  "document:review_updated": (status: string) => void;
}

export interface ClientToServerEvents {
  "doc:join": (docId: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  "doc:leave": (docId: string) => void;
  "sync:update": (docId: string, update: Uint8Array) => void;
  "sync:awareness": (docId: string, update: Uint8Array) => void;
  "comment:thread_created": (docId: string, thread: CommentThread) => void;
  "comment:added": (docId: string, comment: Comment) => void;
  "comment:resolved": (docId: string, threadId: string) => void;
  "document:renamed": (docId: string, newTitle: string) => void;
}

// Presence

export interface PresenceUser {
  id: string;
  displayName: string;
  color: string;
  cursor?: { line: number; column: number };
}

// Comments

export interface Comment {
  id: string;
  threadId: string;
  authorId: string;
  authorName?: string; // Hydrated by join
  content: string;
  createdAt: string;
}

export interface CommentThread {
  id: string;
  documentId: string;
  lineNumber: number;
  resolved: boolean;
  createdAt: string;
  comments: Comment[]; // Hydrated by join
}

// API Response Wrappers

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
