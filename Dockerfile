# DebtNav: one container serving the built SPA and the API on one origin (see docs/BACKEND.md).
# Secrets (DATABASE_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET) are provided at runtime, never baked in.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx tsc --noEmit && npx tsc --noEmit -p server && npx vite build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json ./
# The API runs TypeScript through tsx (a dev dependency), so the full install is kept.
RUN npm ci && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8787/api/health || exit 1
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/src/index.ts"]
