# Alwaysdata Music API (多梯队免 VIP 音源解析引擎)

专为 Alwaysdata 等轻量主机设计的单文件打包音源 API，完全兼容前端播放器。

---

## 目录结构

```text
├── .github/
│   └── workflows/
│       └── release.yml     # GitHub Actions 自动化单文件打包 Release 工作流
├── src/
│   └── app.js              # 核心服务代码（三梯队多源融合引擎）
├── package.json            # 依赖配置与打包指令
├── package-lock.json       # 锁定依赖版本
├── .gitignore
└── README.md
```

---

## 核心特性：三梯队音源融合流水线

针对没有 VIP 账号的用户，API 内部实现了**无感三梯队自动降级与替换**：

```text
               用户请求 /music/qq_song_kw.php
                            │
               ┌────────────▼────────────┐
               │  第一梯队：QQ 音乐官方源   │ （免费歌/配置了VIP Cookie直接秒播）
               └────────────┬────────────┘
                     失败/VIP (无直链)
                            │
               ┌────────────▼────────────┐
               │  第二梯队：落雪音乐公开源 │ （若配置了 LX_SOURCE_URL 自动解析）
               └────────────┬────────────┘
                         失败/未配置
                            │
               ┌────────────▼────────────┐
               │  第三梯队：酷我跨平台音源 │ （自动用歌名+歌手搜索匹配免VIP直链）
               └────────────┬────────────┘
                         成功解析
                            │
                      返回播放直链
```

1. **第一梯队（QQ 官方原音）**：优先尝试 QQ 音乐官方 VKey，免费歌曲直接秒播官方原质原声。
2. **第二梯队（落雪 LX 社区源）**：若在环境变量配置了 `LX_SOURCE_URL`，自动调用社区维护的大神源进行原歌曲解析。
3. **第三梯队（酷我跨平台免 VIP 兜底）**：自动利用 `歌名 + 歌手名` 检索酷我音乐同名歌曲，无缝获取高品 MP3/FLAC 直链返回！
4. **单文件编译打包**：基于 `@vercel/ncc`，编译后仅包含单个独立 `app.js`（约 800 KB），无需在 Alwaysdata 服务器上装庞大的 `node_modules`，完美契合 Alwaysdata 100MB 免费配额。
5. **强制 HTTPS 播放直链**：所有返回直链自动转换为 `https://`，防止混合内容（Mixed Content）被浏览器拦截。

---

## 环境变量配置（可选）

部署在 Alwaysdata 时，在后台 Sites 或环境设置中支持以下变量（不配则默认启用 QQ 官方 + 酷我免 VIP 兜底）：

| 环境变量名 | 作用说明 | 默认值 |
|---|---|---|
| `PORT` | 服务监听端口（Alwaysdata 自动注入） | `8100` |
| `IP` | 服务监听 IP（Alwaysdata 自动注入） | `::` |
| `LX_SOURCE_URL` | 落雪音乐自定义音源服务地址（例如 `https://your-lx-source.com`） | *空（未启用）* |
| `LX_SOURCE_KEY` | 请求落雪音源时的密钥（对应请求头 `X-Request-Key`，无则留空） | *空* |
| `API_TOKEN` | 接口访问 Token。设置后客户端需在 Header 传 `X-API-Token` 或 Query 传 `?token=` | *空（公开）* |
| `ALLOWED_ORIGIN` | 跨域允许来源域名 | `*` |
| `QQ_COOKIE` | 个人 QQ 音乐账号 Cookie（若有 VIP 账号可填入，没有留空即可） | *空* |
| `QQ_UIN` | 对应的 QQ 号 | `0` |

---

## 本地开发与手动打包

```bash
# 安装依赖
npm install

# 本地调试运行
npm run dev

# 打包为单文件
npm run build
# 打包产物位于 dist/index.js
```

---

## Alwaysdata 极速部署指引

1. **获取打包文件**：
   从 GitHub Releases 页面下载最新版本的 `music-api-dist.zip`，解压得到单文件 `app.js`。
2. **Alwaysdata 后台创建站点**：
   - **Type**: `Node.js`
   - **Application path**: `/music-api/app.js`
   - **Working directory**: `/music-api`
3. **上传并启动**：
   在 Alwaysdata 的 **Files** 文件管理器中，将解压出来的 `app.js` 上传到 `/music-api/` 目录下，随后点击 **Web ➡️ Sites** 中的 **Restart** 重启站点即可。
