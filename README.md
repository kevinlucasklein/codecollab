# CodeCollab

CodeCollab is a real-time collaborative code review and editing platform. Built with modern web technologies, it allows multiple developers to edit code simultaneously, add line-level comments, and synchronize directly with GitHub repositories—all with zero merge conflicts thanks to CRDTs (Conflict-free Replicated Data Types).

## 🚀 Features

- **Real-Time Collaboration**: Edit code simultaneously with other developers. Powered by [Yjs](https://yjs.dev/) for robust CRDT-based synchronization and [Socket.IO](https://socket.io/) for low-latency WebSockets.
- **Multiplayer Cursors & Presence**: See exactly where your teammates are looking and typing with live cursor tracking and presence indicators.
- **Line-Level Commenting**: Professional code review capabilities. Highlight specific lines in the editor to start threaded conversations, which are instantly broadcasted to all active participants.
- **GitHub Integration**: Connect your GitHub account to seamlessly pull source code from repositories and branches directly into collaborative review sessions.
- **Rich Code Editing**: Powered by [CodeMirror 6](https://codemirror.net/), featuring syntax highlighting, line numbers, and seamless Yjs integration (`y-codemirror.next`).
- **Offline Resilience**: Built-in reconnection logic with exponential backoff. Yjs automatically merges diverged states upon reconnection without data loss.

## 🏗️ Architecture & Tech Stack

CodeCollab is structured as a **Turborepo** monorepo to cleanly separate frontend and backend environments while sharing TypeScript types and configurations.

- **Frontend (`apps/web`)**: 
  - **Framework**: Next.js 15 (App Router), React 19
  - **Editor**: CodeMirror 6
  - **State/Sync**: Yjs, `y-codemirror.next`, Socket.IO Client
  - **UI**: Lucide React, React Hot Toast
- **Backend (`apps/server`)**: 
  - **Framework**: Node.js, Express
  - **Real-time**: Socket.IO
  - **Database**: PostgreSQL (via `pg`)
  - **Auth**: JWT, bcryptjs, GitHub API (Octokit)
  - **Sync**: Yjs (Server-side state management and binary snapshot persistence)
- **Shared (`packages/shared`)**:
  - Shared TypeScript interfaces, database schemas, and WebSocket event contracts.

## ⚙️ Getting Started

### Prerequisites

- Node.js (v18+)
- pnpm (`npm install -g pnpm`)
- PostgreSQL (v16+) - Docker is recommended for local development:
  ```bash
  docker run -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16
  ```

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/codecollab.git
   cd codecollab
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   Copy `.env.example` to `.env` in the root (and within specific apps if necessary) and configure your PostgreSQL database URL and JWT secret.
   ```bash
   cp .env.example .env
   ```

4. Run database migrations:
   ```bash
   pnpm run db:migrate
   ```

5. Start the development server:
   ```bash
   pnpm dev
   ```
   This will start both the Next.js frontend (`http://localhost:3000`) and the Express backend (`http://localhost:3001`) concurrently.

## 🧪 Testing

CodeCollab maintains a strong focus on correctness and engineering rigor.

- **Unit & Integration Tests**: Built with **Vitest** and **Supertest** to thoroughly test the REST API, Authentication flows, Document CRUD operations, and Yjs utility functions.
- Run tests across all packages:
  ```bash
  pnpm test
  ```

## 🧠 Why Yjs / CRDTs?

Traditional "last-write-wins" algorithms or Operational Transformation (OT) can be complex and error-prone when scaling collaborative tools. By using **Yjs**, a mature CRDT implementation, CodeCollab ensures:
- Mathematical guarantees that all clients will eventually converge to the exact same state.
- Efficient binary encoding for fast network transport and compact database storage.
- First-class support for CodeMirror 6 integration and presence awareness.

---
*Built to demonstrate proficiency in full-stack architecture, real-time distributed systems, and modern React ecosystems.*
