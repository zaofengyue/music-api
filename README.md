# Alwaysdata Music API (QQ 音乐解析音源接口)

专为 Alwaysdata 等轻量主机设计的单文件打包音源 API，完全兼容前端播放器。

---

## 目录结构

```text
api/
├── .github/
│   └── workflows/
│       └── release.yml     # 独立仓库时的 GitHub Actions 打包工作流
├── src/
│   └── app.js              # 核心代码（适配 Alwaysdata 端口/IP）
├── package.json            # 依赖管理与打包指令
├── .gitignore
└── README.md
```

---

## 核心特性

- **单文件编译打包**：基于 `@vercel/ncc`，编译后仅保留一个独立 `app.js`（约 2~3MB），无需在 Alwaysdata 服务器上装庞大的 `node_modules`，极大节省空间（适合 Alwaysdata 100MB 免费配额）。
- **完全兼容播放器**：提供 `/music/qq_song_kw.php?id={songmid}&level={level}` 接口，返回 `{ data: { url: "..." } }`。
- **免手动部署**：通过 GitHub Actions 自动编译生成 `music-api-dist.zip`，下载后将里面的 `app.js` 上传到 Alwaysdata 即可使用。

---

## 本地开发与手动打包

```bash
cd api
npm install

# 本地调试运行
npm run dev

# 打包为单文件
npm run build
# 打包产物位于 dist/index.js
```

---

## Alwaysdata 部署指引

1. **GitHub Release 下载**：
   下载 Action 生成的 `music-api-dist.zip`，解压得到单文件 `app.js`。
2. **Alwaysdata 后台创建站点**：
   - **Type**: Node.js
   - **Application path**: `/music-api/app.js`
   - **Working directory**: `/music-api`
3. **上传文件**：
   在 Alwaysdata 的 Files 中，在 `/music-api/` 目录下上传解压出的 `app.js`。
4. **启动**：
   点击 **Restart** 重启站点即可。
