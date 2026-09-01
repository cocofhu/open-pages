# Open Pages

Typora 风格的 Web Markdown 编辑器：本地/离线写稿，服务端用白名单主题跑 `hexo generate` 预览，登录 GitHub 后将源码推到 `main`、静态站点推到 `gh-pages` 并启用 GitHub Pages。

## 功能

- 所见即所得写作（Milkdown Crepe）+ 源码模式
- 文章 / 草稿 / 页面 / 图片，IndexedDB 持久化，PWA 离线可用
- `_config.yml` 可视化配置，预装 13 个主题，也可从 npm / GitHub 安装 Hexo 主题
- Hexo 插件管理：核心插件受保护，可安装、启停和配置额外插件
- Hexo 真实预览（不是前端 Markdown 渲染）
- GitHub OAuth，选择或创建仓库后一键发布

自定义 theme / plugin 只会在无会话密钥的限时 worker 中执行，不会加载进 API
进程；worker 通过 Node 文件权限只读当前站点和扩展、只写本次构建目录与临时目录。
安装过程禁用 npm lifecycle scripts，但第三方生成代码仍可能不安全；只安装可信
来源。默认必须先登录才可安装，开发环境可设置 `ALLOW_GUEST_ADDONS=true` 允许访客安装。

## 主题与插件扩展

设置页支持 npm 包名（如 `hexo-theme-fluid`、`hexo-generator-sitemap`）和公开
GitHub `owner/repo`。用户扩展按登录用户/访客会话隔离保存。

扩展包可选提供 `open-pages.theme.json` 或 `open-pages.plugin.json` 来声明设置
表单：

```json
{
  "label": "My Addon",
  "description": "可选说明",
  "settings": [
    {
      "key": "accent",
      "label": "强调色",
      "yamlPath": "my_addon.accent",
      "group": "外观",
      "type": "text",
      "default": "#3366ff"
    }
  ]
}
```

支持的字段类型为 `text`、`toggle`、`choice`、`swatch`。没有扩展清单时，主题和
插件仍可通过 YAML 配置。自装扩展仅用于服务端生成静态站，不会提交到源码分支。

## 开发

需要 Node 20+ 与 pnpm 10。

```bash
cp .env.example apps/api/.env
pnpm install
pnpm dev
```

- 编辑器：http://localhost:5173
- API：http://localhost:8787
- 预览：http://localhost:8788

预览单独占一个源。生成出来的站点会执行主题自带的脚本，而主题是第三方代码，
放在独立源上它就拿不到编辑器的会话 cookie，也够不着编辑器的 DOM。预览地址里
带一段签名的能力密钥代替 cookie 鉴权，所以部署时 `PREVIEW_ORIGIN` 必须和
`APP_ORIGIN` 不同源。

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
