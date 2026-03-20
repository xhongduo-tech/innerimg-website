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

### 3. Docker 一体镜像（前端 + API + 静态资源）

镜像内会先构建 `web`，再编译 `server`，运行时由 Fastify 同时托管 **`/` 前端**、`/api` **接口**与 **`/files/` 上传目录**。

```bash
# 构建
docker build -t innerimg .

# 运行（务必设置公网可访问的根地址，供生成完整图片 URL）
docker run --rm -p 3000:3000 \
  -e PUBLIC_BASE_URL=https://你的域名 \
  -v innerimg-data:/app/data \
  innerimg
```

或使用 Compose（默认 `PUBLIC_BASE_URL=http://localhost:3000`，公网部署请在本机创建 `.env` 覆盖）：

```bash
docker compose up -d --build
```

数据卷 `innerimg_data` 持久化 `/app/data`（SQLite 与上传文件）。多副本水平扩展时请勿共用 SQLite 写入，应换共享对象存储与独立数据库，见上文「架构与扩展」。

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
