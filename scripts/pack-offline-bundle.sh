#!/usr/bin/env bash
set -euo pipefail

# 在【联网】笔记本上运行：构建 amd64 镜像、拉取 nginx、打 tar，并收集离线 compose 文件。
# 将生成的 offline-bundle/ 拷到 U 盘，在内网服务器 docker load 后按 docs/OFFLINE_DEPLOY.md 启动。

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PLATFORM="${PLATFORM:-linux/amd64}"
NGINX_IMAGE="${NGINX_IMAGE:-nginx:1.27-alpine}"
OUT_DIR="${OUT_DIR:-$ROOT/offline-bundle}"
TS="$(date +%Y%m%d-%H%M%S)"

echo "==> [1/4] 构建应用镜像 innerimg:latest（平台见 Dockerfile / compose）"
docker compose build innerimg

echo "==> [2/4] 拉取 Nginx 镜像（将一并打入离线包）"
docker pull --platform "${PLATFORM}" "${NGINX_IMAGE}"

echo "==> [3/4] 导出镜像为 tar"
mkdir -p "${OUT_DIR}"
TAR="${OUT_DIR}/innerimg-docker-images-${TS}.tar"
docker save -o "${TAR}" innerimg:latest "${NGINX_IMAGE}"

echo "==> [4/4] 复制编排与配置"
cp docker-compose.yml docker-compose.offline.yml "${OUT_DIR}/"
cp -r nginx "${OUT_DIR}/"
cp .env.compose.example "${OUT_DIR}/"
cp docs/OFFLINE_DEPLOY.md "${OUT_DIR}/"

echo ""
echo "完成。请将整个目录拷到 U 盘："
echo "  ${OUT_DIR}"
echo ""
echo "内网服务器：cd 该目录 && docker load -i innerimg-docker-images-*.tar"
echo "然后：docker compose -f docker-compose.yml -f docker-compose.offline.yml up -d"
echo "（详见 ${OUT_DIR}/OFFLINE_DEPLOY.md）"
ls -lah "${OUT_DIR}"
