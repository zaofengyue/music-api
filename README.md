# Alwaysdata Music API (QQ 音乐解析音源接口)

专为 Alwaysdata 等轻量主机设计的单文件打包音源 API，完全兼容前端播放器。

---

## 目录结构

```text
├── .github/
│   └── workflows/
│       └── release.yml     # GitHub Actions 自动化单文件打包 Release 工作流
├── src/
│   └── app.js              # 核心服务代码（适配 Alwaysdata 端口/IP 与音质降级）
├── package.json            # 依赖配置与打包指令
├── package-lock.json       # 锁定依赖版本
├── .gitignore
└── README.md
```

---

## 特性与优化

1. **单文件编译打包**：基于 `@vercel/ncc`，编译后仅包含单个独立 `app.js`（约 2~3MB），无需在 Alwaysdata 服务器上装庞大的 `node_modules`，极大节省空间（适合 Alwaysdata 100MB 免费配额）。
2. **多音质自动降级**：请求无损（FLAC）若无权限，会自动按 `lossless` ➡️ `exhigh(320k)` ➡️ `standard(128k)` ➡️ `m4a(C400)` 顺序自动尝试降级，且一次性批量获取，不增加网络往返延时。
3. **C400 M4A 备选格式**：加入了主流的 M4A 格式作为兜底，大幅提高免费非 VIP 歌曲的解析成功率。
4. **强制 HTTPS 播放链接**：自动将上游下发的 `http://` 转换为 `https://`，防止现代浏览器发生混合内容（Mixed Content）安全拦截。
5. **健壮性与安全防护**：
   - 参数校验：校验 `id` (songmid) 与可选的 `media_mid` 格式。
   - 超时保护：内置 8 秒超时机制，防止上游挂起阻塞 Node.js 进程。
   - 错误脱敏：异常时不向前端泄露服务器内部堆栈或错误详情。
   - 防刷限流：单 IP 每分钟最多允许 60 次解析请求。
   - 可选 Token 鉴权与 CORS：支持通过环境变量设置鉴权密钥与允许域名。

---

## 环境变量配置（可选）

部署在 Alwaysdata 或其他服务器时，支持以下环境变量（如无需限制可保持默认）：

| 环境变量名 | 作用说明 | 默认值 |
|---|---|---|
| `PORT` | 服务监听端口（Alwaysdata 自动注入） | `8100` |
| `IP` | 服务监听 IP（Alwaysdata 自动注入） | `::` |
| `API_TOKEN` | 接口访问 Token。设置后客户端需在 Header 传 `X-API-Token` 或 Query 传 `?token=` | *空（公开）* |
| `ALLOWED_ORIGIN` | 跨域允许来源域名 | `*` |
| `QQ_COOKIE` | 个人 QQ 音乐账号 Cookie（配置后可大幅提高 VIP 歌曲/高品质音乐解析成功率） | *空（匿名）* |
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
