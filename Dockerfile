# ---------- Stage 1: install production dependencies ----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- Stage 2: slim, hardened runtime ----------
FROM node:24-alpine
WORKDIR /usr/src/app

# Security hardening: npm/corepack aren't needed at runtime and their bundled
# packages are a common source of Trivy HIGH findings, so remove them.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js notify.js ./
COPY scripts ./scripts
COPY public ./public

# Run as the unprivileged 'node' user, not root
RUN mkdir -p data && chown -R node:node /usr/src/app
USER node

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    DB_PATH=/usr/src/app/data/app.db \
    NODE_NO_WARNINGS=1

LABEL org.opencontainers.image.title="mmm-art-studio" \
      org.opencontainers.image.version="${APP_VERSION}"

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
