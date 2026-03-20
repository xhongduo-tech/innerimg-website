# 单阶段：顺序构建前端 + 后端，逻辑直观；镜像略高于多阶段可后续再优化。
# 固定 linux/amd64，便于在 Mac（含 Apple Silicon）上构建、在 x86 服务器上运行。
FROM --platform=linux/amd64 node:22-bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# 前端
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

# 后端：编译阶段需要 devDependencies（typescript / tsc），编译后再删掉以缩小镜像
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server ./server
RUN cd server && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV WEB_DIST=/app/web/dist
ENV UPLOAD_DIR=/app/data/uploads
ENV DB_PATH=/app/data/innerimg.db
ENV PORT=3000
ENV HOST=0.0.0.0

WORKDIR /app/server
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
