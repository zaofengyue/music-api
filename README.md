# Music API (四梯队免 VIP 音源解析引擎 · 支持 Alwaysdata 与 Docker)

专为轻量主机（Alwaysdata）与容器化部署（Docker / VPS / NAS / 云容器）设计的音源解析 API，完全兼容前端播放器。

---

## 目录结构

```text
├── .github/
│   └── workflows/
│       └── release.yml     # 自动打包单文件 Release + 自动构建推送 GHCR Docker 镜像
├── src/
│   └── app.js              # 核心服务代码（四梯队多源融合 + LRU 内存缓存）
├── Dockerfile              # 多阶段极简 Docker 构建文件（基于 node:20-alpine）
├── docker-compose.yml      # Docker Compose 一键编排配置
├── .dockerignore
├── package.json            # 依赖配置与打包指令
├── package-lock.json       # 锁定依赖版本
├── .gitignore
└── README.md
```

---

## 核心特性：四梯队音源融合流水线

针对没有 VIP 账号的用户，API 内部实现了**无感四梯队自动降级与跨平台替换**，并内置 **LRU 内存缓存**：

```text
               用户请求 /music/qq_song_kw.php
                            │
               ┌────────────▼────────────┐
               │   LRU 短期内存缓存检查    │ （默认缓存 20 分钟，命中 0ms 秒返）
               └────────────┬────────────┘
                         未命中
                            │
               ┌────────────▼────────────┐
               │  第一梯队：QQ 音乐官方源   │ （免费歌/配置了VIP Cookie直接秒播）
               └────────────┬────────────┘
                     失败/VIP (无直链)
                            │
               ┌────────────▼────────────┐
               │  第二梯队：落雪音乐公开源 │ （若配置了 LX_SOURCE_URL 自动降级解析）
               └────────────┬────────────┘
                         失败/未配置
                            │
               ┌────────────▼────────────┐
               │  第三梯队：酷我跨平台音源 │ （过滤伴奏与假音频，智能匹配免VIP直链）
               └────────────┬────────────┘
                            失败
                            │
               ┌────────────▼────────────┐
               │  第四梯队：网易云跨平台源 │ （批量检索并过滤30s试听，返回完整直链）
               └────────────┬────────────┘
                         成功解析
                            │
                  写入缓存 & 返回播放直链
```

---

## 环境变量配置（可选）

| 环境变量名 | 作用说明 | 默认值 |
|---|---|---|
| `PORT` | 服务监听端口 | `8100` |
| `IP` | 服务监听地址（Docker 中默认为 `0.0.0.0`） | `::` |
| `CACHE_TTL_SECONDS` | 解析结果内存缓存时间（秒），设为 `0` 可关闭缓存；请求带 `?nocache=1` 可强制刷新 | `1200` (20分钟) |
| `RATE_LIMIT_MAX` | 单 IP 每分钟最大允许请求次数 | `60` |
| `API_TOKEN` | 接口访问 Token。设置后客户端需在 Header 传 `X-API-Token` 或 Query 传 `?token=` | *空（公开）* |
| `ALLOWED_ORIGIN` | 跨域允许来源域名 | `*` |
| `LX_SOURCE_URL` | 落雪音乐自定义音源服务地址（例如 `https://your-lx-source.com`） | *空（未启用）* |
| `LX_SOURCE_KEY` | 请求落雪音源时的密钥（对应请求头 `X-Request-Key`，无则留空） | *空* |
| `QQ_COOKIE` | 个人 QQ 音乐账号 Cookie（若有 VIP 账号可填入，没有留空即可） | *空* |
| `QQ_UIN` | 对应的 QQ 号 | `0` |
| `NETEASE_COOKIE` | 网易云音乐 Cookie | `os=pc; appver=2.9.7` |

---

## 部署方式一：Docker 一键部署（推荐 VPS / NAS / 云容器）

每次发布版本时，GitHub Actions 会自动构建 `linux/amd64` 与 `linux/arm64` 双架构镜像并推送至 `ghcr.io/zaofengyue/music-api`。

### 1. 使用 `docker run` 直接启动
```bash
docker run -d \
  --name music-api \
  --restart unless-stopped \
  -p 8100:8100 \
  -e CACHE_TTL_SECONDS=1200 \
  ghcr.io/zaofengyue/music-api:latest
```

### 2. 使用 `docker compose` 启动
```bash
docker compose up -d
```

---

## 部署方式二：Alwaysdata 单文件极速部署

1. **获取打包文件**：
   从 GitHub Releases 页面下载最新版本的 `music-api-dist.zip`，解压得到单文件 `app.js`。
2. **Alwaysdata 后台创建站点**：
   - **Type**: `Node.js`
   - **Application path**: `/music-api/app.js`
   - **Working directory**: `/music-api`
3. **上传并启动**：
   在 Alwaysdata 的 **Files** 文件管理器中，将解压出来的 `app.js` 上传到 `/music-api/` 目录下，随后点击 **Web ➡️ Sites** 中的 **Restart** 重启站点即可。
