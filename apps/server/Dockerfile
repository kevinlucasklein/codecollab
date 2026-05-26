FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy package.jsons for all packages
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/

# Build shared package first, then server
RUN pnpm --filter @codecollab/shared build
RUN pnpm --filter @codecollab/server build

# Copy schema.sql to dist (tsc doesn't copy non-TS files)
RUN cp apps/server/src/db/schema.sql apps/server/dist/db/schema.sql

# Production stage
FROM node:20-slim AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy everything needed to run
COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/shared ./packages/shared
COPY --from=base /app/apps/server ./apps/server

ENV NODE_ENV=production

# Run the migration then start the server
CMD ["sh", "-c", "cd apps/server && node dist/db/migrate.js 2>/dev/null; node dist/server.js"]
