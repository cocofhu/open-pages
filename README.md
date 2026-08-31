# Open Pages

Typora 风格的 Web Markdown 编辑器：本地/离线写稿，服务端用白名单主题跑 `hexo generate` 预览，登录 GitHub 后将源码推到 `main`、静态站点推到 `gh-pages` 并启用 GitHub Pages。

## 功能

- 所见即所得写作（Milkdown Crepe）+ 源码模式
- 文章 / 草稿 / 页面 / 图片，IndexedDB 持久化，PWA 离线可用
- `_config.yml` 可视化配置，主题仅允许 `landscape` / `cactus` / `next`
- Hexo 真实预览（不是前端 Markdown 渲染）
- GitHub OAuth，选择或创建仓库后一键发布

自定义 theme / plugin 不会在服务器上执行。

## 开发

需要 Node 20+ 与 pnpm 10。

```bash
cp .env.example apps/api/.env
pnpm install
pnpm dev
```

- 编辑器：http://localhost:5173
- API：http://localhost:8787

```bash
pnpm test:e2e
```

GitHub 登录需创建 OAuth App：

- Homepage：`http://localhost:5173`
- Callback：`http://localhost:5173/auth/github/callback`

把 Client ID / Secret 写入 `apps/api/.env`。未配置时仍可本地写作与（本机 API 可用时）Hexo 预览，但不能发布。

## 发布流程

1. 源文件提交到仓库默认 `main`
2. 服务端 `hexo generate`
3. `public/` 提交到 `gh-pages`
4. 调用 GitHub Pages API，`source.branch = gh-pages`
