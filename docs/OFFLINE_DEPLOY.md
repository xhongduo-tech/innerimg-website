# 离线 / 内网（U 盘）部署说明

适用场景：在**能上网的笔记本**上构建并导出镜像，通过 **U 盘**拷贝到**无法访问互联网**的内网 x86 服务器上运行。

## 你需要理解的两点

1. **镜像里已经包含运行所需层**：内网机只需 `docker load`，**不要再执行 `docker compose build`**，也不要能访问 Docker Hub（除非你有内网镜像仓库并已推上去）。
2. **Compose 里还有官方 `nginx` 镜像**：离线时必须把 **`innerimg:latest` 和 `nginx:1.27-alpine` 两个镜像都打进同一个 tar**（下文脚本已处理），或分两个 tar 分别 `docker load`。

## A. 在联网笔记本上准备（只需做一次）

### 方式一：一键打包（推荐）

在项目根目录执行：

```bash
chmod +x scripts/pack-offline-bundle.sh
./scripts/pack-offline-bundle.sh
```

会在项目下生成 **`offline-bundle/`** 目录，其中包含：

| 文件/目录 | 说明 |
|-----------|------|
| `innerimg-docker-images-*.tar` | **多镜像合一**：`innerimg:latest` + `nginx:1.27-alpine` |
| `docker-compose.yml` | 主编排 |
| `docker-compose.offline.yml` | 离线覆盖：禁用 build、禁止 pull |
| `nginx/` | Nginx 配置（路径需与 compose 一致） |
| `.env.compose.example` | 环境变量示例 |
| 本说明 `OFFLINE_DEPLOY.md` | 可拷到 U 盘备查 |

将整个 **`offline-bundle`** 文件夹复制到 U 盘。

（可选）若 tar 很大，可在笔记本上压缩后再拷：

```bash
gzip -k offline-bundle/innerimg-docker-images-*.tar
```

内网机解压：`gunzip -k xxx.tar.gz` 得到 `.tar`。

### 方式二：手动命令

```bash
# 1. 构建应用镜像（Dockerfile 已固定 linux/amd64）
docker compose build innerimg

# 2. 拉取与 compose 中一致的 Nginx 镜像（需联网一次）
docker pull --platform linux/amd64 nginx:1.27-alpine

# 3. 导出为一个 tar（两个镜像都在里面）
docker save -o innerimg-offline-images.tar innerimg:latest nginx:1.27-alpine
```

再手动拷贝：`docker-compose.yml`、`docker-compose.offline.yml`、`nginx/`、`.env.compose.example`、本说明文档。

## B. 内网服务器上部署

**假设**已安装 Docker Engine 与 Docker Compose 插件（版本建议较新，以支持 `build: null` / `pull_policy`）。若内网软件源无法装 Docker，需你们单位另提供安装包或内网镜像站，本文不展开。

1. 将 U 盘里的 **`offline-bundle`** 整目录拷到服务器某路径，例如 `/opt/innerimg`。
2. 进入目录：
   ```bash
   cd /opt/innerimg
   ```
3. 导入镜像（文件名按实际修改）：
   ```bash
   docker load -i innerimg-docker-images-*.tar
   ```
   执行后应能看到 `innerimg:latest` 与 `nginx:1.27-alpine`。
4. 配置环境变量（**重要**：需填内网用户实际访问的地址，否则生成的图片 URL 会错）：
   ```bash
   cp .env.compose.example .env
   ```
   编辑 `.env`，至少设置：
   - `PUBLIC_BASE_URL`：例如 `http://10.0.0.5:3000` 或 `http://img.internal.corp:3000`（与最终浏览器访问入口一致，**含端口**）。
   - `PORT`：宿主机映射端口，默认 `3000`。
5. 启动（**必须带上 offline 叠加文件**，避免去外网 pull / 在内网 build）：
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.offline.yml up -d
   ```
6. 在能访问该服务器的机器浏览器打开：`PUBLIC_BASE_URL` 所配置的地址。

### 常用运维命令

```bash
docker compose -f docker-compose.yml -f docker-compose.offline.yml ps
docker compose -f docker-compose.yml -f docker-compose.offline.yml logs -f
docker compose -f docker-compose.yml -f docker-compose.offline.yml down
```

数据在 Docker 卷 **`innerimg_data`** 中；`down` 默认不删卷，升级镜像后可再次 `load` 新 tar 后 `up -d` 滚动替换（注意数据备份）。

## C. 无 Nginx、仅单容器（可选）

若内网规则不允许多用一层镜像，可在内网只 `docker load innerimg:latest`（导出 tar 时只 save 这一个），并用 `docker run` 直接暴露 3000 端口。需在笔记本单独导出：

```bash
docker save -o innerimg-only.tar innerimg:latest
```

内网：

```bash
docker load -i innerimg-only.tar
docker run -d --name innerimg -p 3000:3000 \
  -e PUBLIC_BASE_URL=http://内网IP:3000 \
  -e WEB_DIST=/app/web/dist \
  -v innerimg-data:/app/data \
  --restart unless-stopped \
  innerimg:latest
```

此时无 Nginx；大文件上传限制在应用层 `MAX_FILE_MB` 等环境变量上调整。

## D. 版本与兼容性说明

- 镜像按 **`linux/amd64`** 构建，适用于常见 x86_64 内网机；ARM 服务器需在五联网环境另打对应平台镜像。
- 若内网 `docker compose` 较旧，不支持 `pull_policy: never`，可尝试升级 Docker，或在内网手动 `docker load` 后使用仅含 `image:` 的简化 compose（需自行去掉 `build:` 段）。
