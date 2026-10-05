# 部署说明

## 一键部署

[![Deploy to Vercel][vercel-button]][vercel-deploy]
[![Deploy to Cloudflare][cloudflare-button]][cloudflare-deploy]

1. 点击目标平台按钮，登录 Vercel 或 Cloudflare，并连接自己的 Git 账号。
2. 确认克隆后的仓库与项目名称；Cloudflare 还会确认 Worker 名称。
3. 使用仓库提供的配置部署，不必填写 VPS 密钥、面板密码或 Redis。
4. 打开新分配的 HTTPS 地址，在页面填写自己的 VEID 与 API Key。

按钮使用平台官方的克隆与部署流程，不共享作者的 VPS 或平台账号。
源码目前仍为 Private，公共用户须等仓库公开后才能从按钮克隆部署；
公开前拥有源码访问权的账号可使用下面的手动导入流程。
也可先访问 [现有公网面板](https://bwg-usage.vercel.app/) 测试界面。

| 运行平台 | 配置 | 构建与产物 |
| --- | --- | --- |
| Vercel | `vercel.json` | `pnpm build:vercel` → `.vercel/output` |
| Cloudflare Workers | `wrangler.jsonc` | `pnpm build:cloudflare` → `.output` 与 Wrangler 配置 |
| Node 服务 | `vite.config.ts` | `pnpm build` → `.output/server/index.mjs` |

三种目标均包含服务端 API；Cloudflare 使用 Workers，不是纯静态 Pages 部署。
不同平台的构建产物不可混用；切换平台时重新执行对应构建。

## 选择运行模式

| 模式 | 配置 | 凭证位置 | 访问保护 |
| --- | --- | --- | --- |
| 浏览器凭证 | 无环境变量 | 用户手动填写，可保存到浏览器 | 默认无面板登录 |
| 密码 + 浏览器凭证 | `APP_ORIGIN`、`PANEL_PASSWORD`、`SESSION_SECRET` | 用户手动填写 | 应用密码 |
| 密码 + 固定目标 | 上述三项加 `BWG_VEID`、`BWG_API_KEY` | 服务端环境变量 | 应用密码且固定目标 |

Redis 对所有模式均可选。未配置时使用每实例限流；配置后使用分布式限流。
默认模式适合自己的面板，不应作为允许所有人调用的无鉴权公共代理。
浏览器填写的 API Key 会经过面板服务端，部署者必须被使用者信任。

## Vercel

一键部署使用上方 Vercel 按钮；需要手动导入时：

1. Fork 仓库，或导入自己有权访问的源码仓库。
2. Framework Preset 选择 **Other**，Node.js Version 选择 **22.x**。
3. 使用根目录及仓库 `vercel.json`，不填写 Next.js 的默认构建或 Output Directory。
4. 按所选模式设置环境变量。浏览器凭证模式可全部留空。
5. 部署成功后打开分配的 HTTPS 域名，在 KiwiVM 获取自己的 VEID 与 API Key 并连接。

仓库已配置安装命令 `pnpm install --frozen-lockfile` 与构建命令 `pnpm build:vercel`。
产物为 `.vercel/output`，包含服务端 API，不能只上传客户端静态文件。
修改环境变量后须重新部署；Production 与 Preview 使用各自的配置。

## Cloudflare Workers

一键部署使用上方 Cloudflare 按钮。平台通过 Workers Builds 克隆、构建并发布 Worker，
仓库会在 Workers Builds 环境自动选择 Cloudflare 构建目标，无需配置数据库或资源绑定。

### 手动导入

在 Cloudflare 控制台进入 **Workers & Pages**，创建 **Worker** 并连接自己的 Git 仓库：

| 设置 | 值 |
| --- | --- |
| 根目录 | 仓库根目录 `/` |
| 构建命令 | `pnpm build` |
| 部署命令 | `pnpm run deploy` |
| Node 版本 | 22.13.0 或更新的 22.x，与仓库 `.nvmrc` 一致 |

安装使用仓库锁文件与 pnpm 版本；不要选择 Pages 的静态输出目录。
`WORKERS_CI=1` 由 Workers Builds 提供，普通 `pnpm build` 在该环境生成 Worker 产物。
在其他 CI 中构建 Worker 时请明确使用 `pnpm build:cloudflare`。
Worker 名称须与 `wrangler.jsonc` 一致；克隆流程可按需调整名称。

Nitro 生成服务端入口、静态资源与 `.output/server/wrangler.json`，
Wrangler 通过 `.wrangler/deploy/config.json` 读取生成配置，无需手工修改产物。
根配置启用 `nodejs_compat`，保留 Node 服务端 API 所需的运行时兼容能力。

### 本地 CLI 部署

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm deploy:cloudflare
```

`deploy:cloudflare` 先构建再执行 Wrangler；`pnpm run deploy` 只部署最近的 Worker 产物，
首次使用或切换构建目标后应运行完整命令。
无需把 Cloudflare 账号 ID 或部署 Token 写入仓库。
自动化 CLI 部署使用平台支持的 `CLOUDFLARE_API_TOKEN`，仅注入 CI 的受保护凭证。

### 可选运行时配置

浏览器凭证模式不添加任何 Secret 即可运行。需要密码或固定 VPS 目标时，
在 Worker 的 **Settings → Variables and Secrets** 设置下方列出的应用变量并部署更新。
密码、会话密钥、VPS API Key 与 Redis Token 使用 **Secret**，不要写入 Wrangler 配置。
也可执行 `pnpm exec wrangler secret put KEY`，将 `KEY` 替换为变量名，按提示录入 Secret。
`APP_ORIGIN` 使用最终 Worker 自定义域名或 `workers.dev` HTTPS origin。
Workers Builds 的构建变量与 Worker 运行时变量不同；应用配置须在运行时可用。
仓库启用 `keep_vars`，后续部署保留控制台运行时变量；
Wrangler 明确声明的变量仍以配置为准，例如 `NODE_ENV=production`。

## 可选环境变量

变量不能添加 `VITE_` 或 `NEXT_PUBLIC_` 前缀。
需要本地配置时，以 `.env.example` 为模板创建被 Git 忽略的 `.env.local`。
模板的可选变量均为注释，不会要求一键部署填写密钥。
仅取消所选模式对应变量前的 `#` 并填写值；密码三项与其他成对配置须一起启用。

| 变量 | 约束 |
| --- | --- |
| `APP_ORIGIN` | 浏览器模式可省略；启用密码时必填完整 HTTPS origin，无路径或末尾 `/` |
| `PANEL_PASSWORD` | 可选，16–1024 字符；设置时须同时配置 origin 与会话密钥 |
| `SESSION_SECRET` | 启用密码时必填，至少 32 字符的随机密钥 |
| `BWG_VEID` | 可选固定目标；与 `BWG_API_KEY` 同时设置，且须启用密码 |
| `BWG_API_KEY` | 固定目标的 API Key，仅供服务端使用 |
| `UPSTASH_REDIS_REST_URL` | 可选 HTTPS REST URL；与 Token 同时设置 |
| `UPSTASH_REDIS_REST_TOKEN` | 可选 Redis REST Token；与 REST URL 同时设置 |

会话密钥可在本地终端生成，再填入平台环境配置，不要将结果提交到仓库：

```sh
pnpm exec node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

固定 origin 示例为 `https://panel.example.com`。
启用密码的 Vercel Preview 或 Worker 预览必须有自己的固定 origin，
任意动态预览域名不会自动获得访问权限。
部分密码配置、无效 origin 或未受保护的服务端凭证会使请求失败，避免静默降低保护。

### 登录、限流与记录

会话有效期为 8 小时，使用 Secure、HttpOnly、SameSite=Strict Cookie。
轮换 `SESSION_SECRET` 后重新部署可撤销所有旧会话；退出只清除当前浏览器会话。

限流额度为登录 10 次/分钟、查询 60 次/分钟、管理操作 5 次/分钟。
未配置 Redis 时实例重启会重置额度，各实例之间不共享计数。
Redis 配置不完整、格式错误或服务不可用时，相关请求失败，不自动退回无保护模式。

固定服务端目标配合 Redis 可保存面板命令记录，保留最近 90 天、最多 200 条。
浏览器凭证模式的面板记录仅保存在本次会话；服务商审计来自 KiwiVM。
限流和历史记录均不保证不同页面的管理操作全局互斥或恰好执行一次。

## 独立 Node 服务

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

默认监听内部 HTTP 端口 3000；生产访问须由反向代理提供 HTTPS，
并向应用传递可信的 HTTPS 协议信息。生产模式会拒绝直接 HTTP 访问，包括 localhost。
本机直接通过 HTTP 开发和调试请使用 `pnpm dev`。
`pnpm start` 不会自动读取 `.env.local`；无配置时运行浏览器凭证模式。
需要密码或固定目标时由运行平台注入环境变量，或执行：

```sh
NODE_ENV=production pnpm exec node --env-file=.env.local .output/server/index.mjs
```

上面的环境变量前缀适用于 POSIX shell；PowerShell 中先运行 `$env:NODE_ENV='production'`，
再执行其余 Node 命令。不要通过开发服务器公开运行生产面板。

## 验证与排错

先运行 `pnpm check`，再执行所选平台的构建与产物验证。
Vercel 使用 `pnpm build:vercel` 与 `pnpm verify:vercel`；
Cloudflare 使用 `pnpm build:cloudflare` 与 `pnpm verify:cloudflare`。
离线集成检查不使用真实 VPS 或 Redis，不能代替部署后的真实域名验证。

| 现象/错误 | 检查方式 |
| --- | --- |
| `SECURITY_NOT_CONFIGURED` | 检查密码三项、origin 格式，以及固定凭证是否同时配置并受密码保护 |
| `INVALID_ORIGIN` | 检查访问域名是否等于配置的 `APP_ORIGIN`，尤其是 Preview 域名 |
| `RATE_LIMIT_UNAVAILABLE` | 检查 Redis 变量是否成对、URL 是否 HTTPS、Redis 是否可用 |
| `RATE_LIMITED` | 等待响应中的 `Retry-After` 秒数；额度可能由同实例其他调用者共享 |
| 样式缺失 | 确认冻结安装、最新锁文件和仓库构建命令，重新部署并检查 CSS 请求 |
| 刷新后未恢复 | 确认已保存当前版本凭证、未主动断开、浏览器允许存储，查看连接错误 |
| 历史为空 | 确认服务商提供该时间范围的样本；面板不会补造缺失历史 |
| 管理操作结果未知 | 在 KiwiVM 核对，不要将刷新或重发当作自动恢复 |

密码模式应匿名跳转登录，登录后正常读取，退出后再次要求登录。
浏览器模式应直接出现凭证表单，保存后刷新自动验证并恢复；主动断开后刷新仍保持断开。
在真实域名上检查桌面与手机 CSS、登录 Cookie 和实时数据，不执行启停作为探活。
失败时使用目标平台的部署版本回滚；不会自动重发管理命令。

## 官方参考

- [Vercel Deploy Button](https://vercel.com/docs/deploy-button)
- [Cloudflare Deploy Buttons][cloudflare-button-docs]
- [Workers Builds 配置][cloudflare-build-docs]

[vercel-button]: https://vercel.com/button
[vercel-deploy]: https://vercel.com/new/clone?repository-url=https://github.com/axin7/bwg-usage
[cloudflare-button]: https://deploy.workers.cloudflare.com/button
[cloudflare-deploy]: https://deploy.workers.cloudflare.com/?url=https://github.com/axin7/bwg-usage
[cloudflare-button-docs]: https://developers.cloudflare.com/workers/platform/deploy-buttons/
[cloudflare-build-docs]: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
