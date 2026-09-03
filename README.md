# Open Pages

Typora 风格的 Markdown 编辑器：本地写稿，用白名单主题跑 `hexo generate` 预览，登录 GitHub 后将源码推到 `main`、静态站点推到 `gh-pages` 并启用 GitHub Pages。

GitHub 集成的推荐路径是 **桌面客户端（Tauri）**：PKCE 登录、Token 存 OS Keychain，不经过自建 Auth 服务。Web 版 OAuth + Session 仍可用，但视为 legacy，后续会退役。

## 功能

- 所见即所得写作（Milkdown Crepe）+ 源码模式
- 文章 / 草稿 / 页面 / 图片，IndexedDB 持久化，PWA 离线可用
- `_config.yml` 可视化配置，预装 13 个主题，也可从 npm / GitHub 安装 Hexo 主题
- Hexo 插件管理：核心插件受保护，可安装、启停和配置额外插件
- Hexo 真实预览（不是前端 Markdown 渲染）
- GitHub 登录后选择或创建仓库，一键发布

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

## 桌面客户端（推荐）

需要 Node 20+、pnpm 10、Rust（[rustup](https://rustup.rs/)）和 Tauri 2 的系统依赖。Linux 上至少安装：

```bash
sudo apt install pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev
```

创建 **OAuth App**（不是 GitHub App）：

| 字段 | 值 |
|------|-----|
| Homepage URL | `https://open-pages.local` |
| Authorization callback URL | `http://127.0.0.1:3847/auth/callback` |

桌面端用 GitHub **Device Flow** 登录（只需 Client ID，不需要 Client Secret）。浏览器会打开设备授权页，按页面提示输入一次性代码即可。

```bash
cp apps/desktop/.env.example apps/desktop/.env
# 写入 GITHUB_CLIENT_ID
export GITHUB_CLIENT_ID=your-client-id
pnpm install
pnpm dev:desktop
```

登录时会打开系统浏览器完成 GitHub 授权，回调到本机 `127.0.0.1:3847`。Token 优先写入系统钥匙串；Linux 无 Secret Service 时回退到 `~/.open-pages/secrets.json`（0600）。

本地站点目录：`~/.open-pages/sites/<siteId>/`。预览由桌面 runtime 提供在 `http://127.0.0.1:8788`。

```bash
pnpm test:github-auth
```

### CI 桌面端打包

推送 `main`、打 `v*` 标签，或改动桌面/Web/共享包相关代码的 PR 会触发 [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)，在三个平台分别构建安装包：

| 平台 | Runner | 产物 |
|------|--------|------|
| Windows x64 | `windows-latest` | `.exe`（NSIS） |
| macOS Apple Silicon | `macos-latest` (`aarch64-apple-darwin`) | `.dmg` / `.app` |
| macOS Intel | `macos-latest` (`x86_64-apple-darwin`) | `.dmg` / `.app` |

构建产物会上传为 GitHub Actions Artifacts（保留 14 天）。推送 `v*` 标签时还会自动创建 Release 并附上安装包。

Windows 只出 NSIS 的 `.exe`（`bundle.targets` 里没有 `msi`）：NSIS 装到当前用户目录、
MSI 装到 `Program Files`，两个装在一起时新版本进的是另一个目录，用户从开始菜单点开的
往往还是旧的那份——看起来就是「装了但没更新」。NSIS 认识已有的 MSI 安装并会先卸掉它，
所以从早期 `.msi` 升级也走同一个 `.exe`。

**Release 内置 GitHub 登录**：在仓库 **Settings → Secrets and variables → Actions → Variables** 添加 `OPEN_PAGES_GITHUB_CLIENT_ID`（OAuth App 的 Client ID；GitHub 禁止变量名以 `GITHUB_` 开头，故用此前缀）。打 `v*` 标签发布时，CI 会在编译阶段把它写进安装包，用户安装后可直接登录，无需再配环境变量。

本地 Release 打包示例：

```bash
export OPEN_PAGES_GITHUB_CLIENT_ID=your-client-id
# 或：export GITHUB_CLIENT_ID=your-client-id
pnpm build:desktop
# macOS 指定架构：
pnpm --filter @open-pages/desktop exec tauri build -- --target aarch64-apple-darwin
pnpm --filter @open-pages/desktop exec tauri build -- --target x86_64-apple-darwin
```

### 安装 macOS 版

推荐命令行安装，自动按 CPU 架构选 `aarch64` / `x64` 的 dmg 装进 `/Applications`，全程没有安全提示：

```bash
curl -fsSL https://raw.githubusercontent.com/cocofhu/open-pages/main/scripts/install-macos.sh | sh
```

从 Release 页面用浏览器下载的话，首次打开会提示"已损坏，无法打开"。安装包只做了 ad-hoc
签名，没有 Apple Developer ID 签名和公证；而 `com.apple.quarantine` 是**下载器**打上的
标记——Chrome、Safari 会打，`curl` 不会。带这个标记的未公证 app，Gatekeeper 在 Apple
Silicon 上就直接报损坏，并不是产物真的坏了。上面的脚本能绕开，正是因为走的 `curl`。

已经用浏览器下载过的，把 app 拖进「应用程序」后执行一次即可，或者右键 → 打开再在弹窗里选「打开」：

```bash
xattr -dr com.apple.quarantine "/Applications/Open Pages.app"
```

ad-hoc 签名会打开 Hardened Runtime。内置的 Node sidecar 依赖 V8 JIT，所以 macOS 打包使用
`apps/desktop/src-tauri/entitlements.plist`（`allow-jit` 等），否则 sidecar 会在启动时
`SIGTRAP`，界面上显示「desktop runtime exited before becoming ready」。

要让用户双击就能装、完全不见提示，需要付费的 Apple Developer 账号（$99/年）：在 CI 配置
`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、
`APPLE_PASSWORD`、`APPLE_TEAM_ID`，`tauri-action` 会自动完成签名与公证。免费开发者账号只能
签 Apple Development 证书，无法用于分发。

### 升级 Windows 版

直接运行新版 `.exe` 覆盖安装即可，不用先卸载。

0.1.16 及更早的版本在 Windows 上装了新版界面还是旧的，根源是 PWA 的 service worker：
Windows 上 Tauri 用 `http://tauri.localhost` 提供前端，这是安全源，于是
`registerSW()` 真的注册成功并把整个 app shell（`index.html` 和带 hash 的 JS/CSS）
预缓存进了 WebView2 的 profile。覆盖安装换掉的是 exe，动不了那份缓存，旧 worker 会继续
用旧的 `index.html` 应答导航，指向的又是它自己缓存的旧资源。macOS 和 Linux 加载同一份产物
走的是 `tauri://` 自定义协议，worker 根本注册不上，所以只有 Windows 会中。

桌面产物因此走 `selfDestroying`：`scripts/tauri-web.mjs` 会带上 `OPEN_PAGES_DESKTOP=1`，
[`apps/web/vite.config.ts`](apps/web/vite.config.ts) 据此生成一个只负责注销自己、清空
`caches` 并让页面重载的 `sw.js`。Web 部署那份产物不受影响，照旧预缓存。已经装了旧版的
机器在下次启动时自动恢复，安装器还会顺手删掉 profile 里的 `Service Worker` 目录，连那次
重载都省了。

同一次安装还有另一个坑：生成工作跑在装到安装目录里的 Node sidecar 上，关掉窗口不会带走
它，NSIS 自带的 CheckIfAppIsRunning 也只认主程序。强杀主程序后 sidecar 变成孤儿进程继续
占着 `node.exe`，Windows 不让覆盖被进程映射的可执行文件，安装就停在「Error opening file
for writing」——点 Abort 等于什么都没装，点 Ignore 会留下半新半旧的一份。两边都补上了：

- [`apps/desktop/src-tauri/windows/hooks.nsh`](apps/desktop/src-tauri/windows/hooks.nsh)
  在复制文件前按安装路径结束残留进程（不碰用户自己的 node）、清掉整棵
  `runtime-bundle`（卸载器只删自己那一版记录过的文件），以及 WebView2 的缓存目录。
- sidecar 收到 `OPEN_PAGES_PARENT_PID`，父进程一没了就连着自己的子进程一起退出，不再留
  孤儿锁住安装目录。

## Web 开发（legacy Auth）

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

Web 版 GitHub 登录仍走服务端 OAuth（legacy）：

- Homepage：`http://localhost:5173`
- Callback：`http://localhost:5173/auth/github/callback`

把 Client ID / Secret 写入 `apps/api/.env`。未配置时仍可本地写作与（本机 API 可用时）Hexo 预览，但不能从浏览器发布。

## 发布流程

1. 源文件提交到仓库默认 `main`
2. 本地或服务端 `hexo generate`
3. `public/` 提交到 `gh-pages`（整树替换）
4. 调用 GitHub Pages API，`source.branch = gh-pages`
