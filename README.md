# InnerImg

面向高并发场景的轻量图片与 Base64 工具平台：互转、生成可直链访问的图片 URL、按 IP 记录操作历史、文件夹批量上传，并**一键生成 OpenAI Chat Completions（多模态 / 视觉）** 请求示例（JSON、`curl`、Python）。

## 功能概览

| 能力 | 说明 |
|------|------|
| 图片 → Base64 | 浏览器读成 Data URL 后交由服务端解析并落库历史 |
| Base64 → 图片 | 解码写入磁盘，返回 `PUBLIC_BASE_URL/files/...` 完整 URL |
| 单文件上传 | multipart 上传，返回同上完整 URL |
| 文件夹批量上传 | `webkitRelativePath` 保留相对路径；每张图唯一文件名；批量返回 URL 列表 |
| 按 IP 历史 | SQLite 记录操作类型与摘要；`trustProxy` + `X-Forwarded-For` 适配反代 |
| OpenAI 策略 | `POST /api/llm/openai-chat-vision` 生成 `messages` + `image_url`，附 `curl` 与 Python |

## 架构与扩展

- **服务端**：Node.js + Fastify，静态文件流式写入（`pipeline`），`better-sqlite3`（WAL），`@fastify/rate-limit`。
- **前端**：Vite + React，开发时代理 `/api`、`/files` 至后端。
- **生产负载**：多实例部署时，上传目录与数据库需放在**共享存储**（如 NFS / 对象存储 + 元数据服务）；SQLite 多写副本不适宜，可改为 PostgreSQL 等；静态文件建议 CDN。

## 快速开始

### 1. 后端

```bash
cd server
cp .env.example .env   # 按环境修改 PUBLIC_BASE_URL
npm install
npm run dev
```

默认监听 `http://0.0.0.0:3000`。

### 2. 前端

```bash
cd web
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`，API 经代理指向本机 3000 端口。

### 3. Docker 部署（推荐：最少操作）

镜像为 **单阶段** 构建（先 `web` 再 `server`，一条 Dockerfile 看完），目标平台固定为 **`linux/amd64`（x86_64）**：在 **Mac（含 M 系列）** 上构建时 Docker 会做模拟/跨平台构建，产出可在常见 **x86 云主机** 直接运行；`docker-compose.yml` 里已写 `platform: linux/amd64`。

**并发说明（是否一定要 Nginx？）**  
- **不需要 Nginx 也能多用户并发**：Node/Fastify 是异步 I/O，单进程可同时处理大量连接与上传。  
- **本仓库 Compose 默认仍带 Nginx**：作为统一入口，便于调大上传体积、超时、HTTPS（可自行在前端加证书）、以及将来在 `upstream` 里挂**多台**应用做横向扩展。仅扩副本时须改用共享存储并替换 SQLite，见下文「架构与扩展」。

#### 操作步骤（复制即用）

1. **安装** [Docker Desktop](https://www.docker.com/products/docker-desktop/)（Mac 上安装后启动一次）。
2. **进入项目根目录**（含 `Dockerfile`、`docker-compose.yml` 的目录）。
3. **（可选）** 复制环境变量示例并修改对外地址（影响生成的图片 URL）：  
   `cp .env.compose.example .env`  
   编辑 `PUBLIC_BASE_URL`（例如本机访问为 `http://localhost:3000`；若前有域名/HTTPS 则写真实入口）。
4. **启动**：  
   `docker compose up -d --build`
5. **浏览器打开**：`http://localhost:3000`（端口由 `.env` 里的 `PORT` 控制，默认 3000；流量路径为 **浏览器 → Nginx → 应用**）。

数据卷 **`innerimg_data`** 持久化 **`/app/data`**（SQLite 与上传文件）。停止：`docker compose down`（卷默认保留）。

#### 离线 / 内网（U 盘拷贝、无外网）

在联网笔记本上打包镜像与编排文件，拷贝到**不通外网**的服务器上 `docker load` 后启动，见 **[docs/OFFLINE_DEPLOY.md](docs/OFFLINE_DEPLOY.md)**。快捷命令：`./scripts/pack-offline-bundle.sh`。

#### 仅 Docker 单容器（不用 Compose / 不用 Nginx）

```bash
docker build --platform linux/amd64 -t innerimg .
docker run --rm -p 3000:3000 \
  -e PUBLIC_BASE_URL=https://你的域名 \
  -e WEB_DIST=/app/web/dist \
  -v innerimg-data:/app/data \
  innerimg
```

此时直接访问容器内 Fastify，无 Nginx；上传大小等需自行在网关或应用中控制。

### 4. 生产构建（仅静态资源，自建网关时）

```bash
cd web && npm run build
```

可将 `web/dist` 交给 Nginx；若由本服务托管静态资源，设置环境变量 **`WEB_DIST`** 指向构建目录即可（Docker 镜像已内置为 `/app/web/dist`）。

## 环境变量

见 `server/.env.example`。部署到公网时务必设置 **`PUBLIC_BASE_URL`** 为浏览器可访问的站点根（例如 `https://cdn.example.com`），否则返回的图片 URL 不可用。

## API 摘要

- `GET /health` — 健康检查  
- `GET /api/config` — 公共配置  
- `GET /api/history?limit=50` — 当前 IP 历史  
- `POST /api/convert/image-to-base64` — `{ "dataUrl": "data:image/png;base64,..." }`  
- `POST /api/convert/base64-to-image` — `{ "base64", "mime?" }`  
- `POST /api/upload` — `multipart` 字段名 `file`  
- `POST /api/upload/batch` — 多个 `files`，文件名含相对路径（文件夹上传）  
- `POST /api/llm/openai-chat-vision` — `{ "model?", "prompt?", "imageUrl?", "imageUrls?", "base64?", "mime?" }`  

OpenAI 调用需自行配置 `OPENAI_API_KEY`；生成结果中的示例使用环境变量占位。

## 许可证

MIT
