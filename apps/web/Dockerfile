FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy package.jsons for all packages
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

# Ensure public directory exists
RUN mkdir -p apps/web/public

# Build shared package first, then web
RUN pnpm --filter @codecollab/shared build
RUN pnpm --filter @codecollab/web build

# Production stage — use Next.js standalone output
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy the standalone server
COPY --from=base /app/apps/web/.next/standalone ./
# Copy static assets
COPY --from=base /app/apps/web/.next/static ./apps/web/.next/static
# Copy public folder
COPY --from=base /app/apps/web/public ./apps/web/public

WORKDIR /app/apps/web

CMD ["node", "server.js"]
