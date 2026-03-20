# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
RUN npm run build
COPY --from=web-build /web/dist ./web/dist
ENV NODE_ENV=production
ENV WEB_DIST=/app/web/dist
ENV UPLOAD_DIR=/app/data/uploads
ENV DB_PATH=/app/data/innerimg.db
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
