# 与 docker-compose 中 platform: linux/amd64 配合：在 ARM Mac 上构建时仍生成 x86_64 镜像，npm ci 会安装 linux-x64 的 sharp 等原生依赖
FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && node -e "require('express'); require('sharp');" \
  && rm -rf /root/.npm
COPY server.js ./
RUN test -f node_modules/express/package.json
EXPOSE 3000
ENV NODE_ENV=production
# 无挂载时直接用镜像内 node_modules；若曾挂载 ./api 覆盖 /app，则在启动时补装依赖（需能访问 npm）
CMD ["sh", "-c", "set -e; cd /app; if [ ! -f node_modules/express/package.json ]; then echo '[innerimg-api] 依赖缺失，执行 npm ci…'; npm ci --omit=dev || npm install --omit=dev; fi; exec node server.js"]
