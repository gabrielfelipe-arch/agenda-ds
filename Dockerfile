# ---------- estágio 1: front-end ----------
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- estágio 2: back-end ----------
FROM node:22-bookworm-slim AS api
WORKDIR /app/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---------- estágio 3: runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY --from=api /app/server/dist ./server/dist
COPY --from=web /app/web/dist ./web/dist

RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node

ENV DATA_DIR=/app/data
ENV UPLOADS_DIR=/app/uploads
ENV WEB_DIR=/app/web/dist
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
