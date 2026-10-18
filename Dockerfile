# DebtNav: one container serving the built SPA and the API on one origin (see docs/BACKEND.md and docs/DEPLOY-RENDER.md).
# Secrets (DATABASE_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET) are provided at runtime, never baked in.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Build tools (TypeScript, Vite) are devDependencies, so the build stage installs everything.
RUN npm ci --include=dev
COPY . .
# Only the app bundle is built here (~200 MB of memory). Type checks run in CI on every push; running
# them here as well needs ~470 MB and exceeded the 512 MB build/run limit of small hosts.
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Runtime needs only production dependencies; tsx (which runs the TypeScript API) is one of them.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
# Writable folder for the embedded database when DATABASE_URL is not set (local trials only).
RUN mkdir -p /app/.data && chown node:node /app/.data
ENV NODE_ENV=production PORT=8787
USER node
EXPOSE 8787
# Hosts such as Render set PORT; the health check follows it.
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://localhost:${PORT}/api/health" || exit 1
# One Node process: `--import tsx` loads TypeScript in-process (the tsx CLI would start a second process).
# The server needs ~110 MB with PostgreSQL; it refuses to start in production without DATABASE_URL.
CMD ["node", "--import", "tsx", "server/src/index.ts"]
