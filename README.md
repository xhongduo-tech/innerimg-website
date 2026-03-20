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

### 3. Docker 部署

镜像为 **单阶段**（Dockerfile 内先构建 `web` 再编译 `server`），目标平台 **`linux/amd64`**，与 `docker-compose.yml` 中 `platform` 一致。在 **Mac（含 M 系列）** 上打 x86 镜像时可能较慢，属正常。

**并发说明**  
- **多用户并发不依赖 Nginx**：Fastify/Node 异步 I/O，单进程即可支撑大量连接。  
- **Compose 默认带 Nginx**：统一入口、上传体积与超时、后续可扩 `upstream`；多副本需共享存储并替换 SQLite，见「架构与扩展」。

#### 你是不是「只执行 pack 就行」？

**不是。** 请先判断服务器能否访问互联网：

| 场景 | 要不要执行 `scripts/pack-offline-bundle.sh` | 你需要做的事 |
|------|---------------------------------------------|--------------|
| **服务器能上网** | **不要执行**（多此一举） | 在服务器上拿到本仓库后：`cp .env.compose.example .env`（按需改 `PUBLIC_BASE_URL`）→ `docker compose up -d --build` → 浏览器访问对应地址。 |
| **服务器不能上网（U 盘离线）** | **要执行**——但 **只在联网笔记本上执行一次**，用于生成搬运包 | **笔记本**：`chmod +x scripts/pack-offline-bundle.sh` → `./scripts/pack-offline-bundle.sh` → 把整个 **`offline-bundle/`** 拷到 U 盘。**内网服务器**：`docker load -i innerimg-docker-images-*.tar` → 进入该目录配置 `.env` → `docker compose -f docker-compose.yml -f docker-compose.offline.yml up -d`。 |

一句话：**Pack = 离线发货前的打包脚本**；联网部署请直接用 **Compose 构建**，不必 pack。

---

#### 路线 A：服务器能联网

1. 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)（或 Linux：Docker Engine + Compose 插件）。
2. 进入本仓库**根目录**。
3. （建议）`cp .env.compose.example .env`，编辑 **`PUBLIC_BASE_URL`** 为最终用户浏览器里的根地址（含端口；决定生成的图片 URL）。
4. `docker compose up -d --build`
5. 打开 `PUBLIC_BASE_URL`（默认 `http://localhost:3000`；映射端口看 `.env` 里 `PORT`）。路径：**浏览器 → Nginx → 应用**。

数据在卷 **`innerimg_data`**（`/app/data`）。停止：`docker compose down`（卷默认保留）。

---

#### 路线 B：纯内网 / U 盘（离线）

**联网笔记本：**

1. `chmod +x scripts/pack-offline-bundle.sh`
2. `./scripts/pack-offline-bundle.sh`  
   得到 **`offline-bundle/`**（含镜像 `*.tar`、`docker-compose.yml`、`docker-compose.offline.yml`、`nginx/`、`.env.compose.example`）。
3. 将 **`offline-bundle/` 整目录**拷到 U 盘（可选对 `*.tar` `gzip` 以缩小体积）。

**内网服务器：**

1. 从 U 盘复制 `offline-bundle/` 到服务器并 `cd` 进入。
2. `docker load -i innerimg-docker-images-*.tar`
3. `cp .env.compose.example .env`，将 **`PUBLIC_BASE_URL`** 设为内网真实访问地址（如 `http://10.0.0.5:3000`）。
4. `docker compose -f docker-compose.yml -f docker-compose.offline.yml up -d`（**必须带 `docker-compose.offline.yml`**，避免内网 pull/build）。

更多备忘与单容器无 Nginx 备选见 **[docs/OFFLINE_DEPLOY.md](docs/OFFLINE_DEPLOY.md)**。

---

#### 仅 Docker 单容器（不用 Compose / 不用 Nginx）

```bash
docker build --platform linux/amd64 -t innerimg .
docker run --rm -p 3000:3000 \
  -e PUBLIC_BASE_URL=https://你的域名 \
  -e WEB_DIST=/app/web/dist \
  -v innerimg-data:/app/data \
  innerimg
```

此时直接访问容器内 Fastify，无 Nginx；上传大小等需在应用环境变量或别处控制。

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
