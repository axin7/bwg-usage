# VPS 控制面板

个人搬瓦工 VPS 资源、流量与操作记录面板，使用 React 19.3、vinext 1.0.1、Nitro 和 Vercel。

## 当前功能

- 总览：套餐配额、内存/Swap/磁盘配置、可用内存、平均负载与限流状态。
- 流量趋势：24 小时、7 天、30 天本地筛选，按需加载图表、分页采样表与 CSV 导出。
- 操作记录：服务商审计与面板命令分别标识，支持来源/结果筛选。

本批未加入连接工具、恢复点列表、后台告警、通知设置或预测。

## 本地开发

需要 Node.js 22 与 pnpm 10.13.1。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm build:vercel
pnpm verify:vercel
```

开发服务仅绑定本机。只有 development/test 环境且实际请求地址为
localhost、127.0.0.1 或 [::1] 时跳过登录与分布式限流。
生产环境不会因 localhost 或转发头绕过认证。

`pnpm build` 生成 Nitro Node 产物；`pnpm start` 运行 `.output/server/index.mjs`。
`pnpm build:vercel` 使用 Vercel preset，生成 `.vercel/output` Build Output。
两种构建均包含服务端 API，不能作为纯静态站点发布。

`pnpm start` 不会自动读取 `.env.local`。独立 Node 运行时须预先导出环境变量，
或使用 `NODE_ENV=production pnpm exec node --env-file=.env.local .output/server/index.mjs`。
Vercel 运行时由平台注入配置。

## Vercel 配置

导入仓库时使用 Other 框架预设，采用仓库 `vercel.json` 的安装和构建命令。
使用 Node.js 22，不要配置 Next.js 的默认构建命令。

默认无需环境变量或 Redis：打开面板后手动填写 VEID 与 API Key，验证成功后
保存在当前浏览器。取消“在此设备保存”则只在当前页面内存中使用。
浏览器模式不要求面板密码，API 每次从请求正文读取用户填写的 VPS 凭证。

需要密码登录或服务端固定目标时，按下表配置对应 Production/Preview 环境。
变量不加 `VITE_` 或 `NEXT_PUBLIC_` 前缀：

| 变量 | 要求 |
| --- | --- |
| `APP_ORIGIN` | 可选固定 HTTPS origin；启用登录时必填，不含路径或末尾 `/` |
| `PANEL_PASSWORD` | 可选面板密码，16–1024 字符；须同时设置 origin 与会话密钥 |
| `SESSION_SECRET` | 启用登录时必填，至少 32 字符的随机会话签名密钥 |
| `UPSTASH_REDIS_REST_URL` | 可选 Upstash Redis HTTPS REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | 可选 Redis REST token，必须与 REST URL 成对设置 |
| `BWG_VEID` | 可选固定目标 VEID；使用服务端凭证时必须启用面板登录 |
| `BWG_API_KEY` | 固定目标的 API Key，必须与 VEID 同时设置并启用面板登录 |

`.env.example` 不包含真实值。需要配置时，真实值放在 Vercel 环境变量或本地
被忽略的 `.env.local`。浏览器模式未指定 origin 时使用实际请求地址校验同源。
启用登录的 Preview 必须使用自己的固定 origin；动态预览域名不自动获得访问权限。
密码配置不完整或格式无效时拒绝访问，服务端 VPS 凭证不会自动退回无登录模式。

启用密码登录后，会话使用 8 小时的 Secure、HttpOnly、SameSite=Strict Cookie。
修改 `SESSION_SECRET` 并重新部署会使现有会话失效；退出登录清除当前浏览器会话。
已复制的会话令牌仍可用至过期，立即撤销需轮换会话密钥。
限流额度为登录 10 次/分钟、查询 60 次/分钟、管理操作 5 次/分钟。
默认在每个运行实例内计数，重启会重置额度，不保证 Vercel 多实例间的全局限制。
可选 Redis 提供分布式限流；部分配置、无效配置或已配置 Redis 故障时拒绝请求。
两种方案都不保证不同页面的管理操作全局互斥或恰好执行一次。

发布前验证所选模式：浏览器模式应直接显示凭证表单，密码模式应先登录。
设置环境变量后需要重新部署；已连接 Vercel 的生产分支提交会触发自动部署。
发生回归时使用 Vercel 的部署回滚；保留登录保护，必要时先关闭面板入口。

## 凭证与操作

设置 `BWG_VEID` 与 `BWG_API_KEY` 后，客户端只取得 VEID，API 固定访问该目标。
API Key 不写入 HTML、客户端构建产物、错误响应或日志。
没有服务端凭证时，页面允许手动输入凭证，默认勾选“在此设备保存”。
验证成功后将 API Key 明文保存到当前浏览器，可取消勾选改为只使用内存。
刷新后会自动验证已保存的当前版本配置，取得实时数据后恢复连接。
断开连接或退出登录保留已保存的配置；清除配置需要单独确认。
主动断开后，当前标签页刷新仍保持断开，手动验证并连接后才恢复自动连接。
旧版保存的配置不会自动发起请求，须明确复用或删除。
清除本机配置不会撤销服务商 API Key；需要撤销时应在 KiwiVM 控制台重置密钥。

每次启停须确认目标。服务商的 `error: 0` 仅表示请求已接收。
超时、网络故障和无法识别的管理响应显示“结果未知”，不会自动重发。
启动/停止可用随后的一次 live 查询核对状态；重启不会仅凭 Running 判定完成。

## 数据与请求

[KiwiVM 官方 API 页面](https://kiwivm.64clouds.com/745491/main.php)需登录后进入 API 菜单。
上游使用固定 HTTPS 地址，以表单 POST 传递凭证，不把 API Key 放进 URL。
`plan_monthly_data` 和 `data_counter` 均按官方 `monthly_data_multiplier` 修正；
未提供倍率时采用 1。内部保存字节，页面使用 GiB。
没有权威周期开始时间，因此日均明确标为估算，UTC 月末采用日期钳制。
未知配额、零配额、超额与未知运行状态分别呈现；重置时间标为北京时间。

普通轮询约 30 秒一次，只查基本信息；隐藏、离线或操作中暂停，失败逐步退避。
总览首次取得基本信息后读取实时资源；此后可见总览至多每 5 分钟自动读取一次。
基本查询保留最近实时指标及其原始采集时间，失败保留上次成功数据并标记过期。
手动刷新和操作后的状态核对使用 live 查询，其官方响应可能耗时 15 秒。
服务端基本查询限时 10 秒，live/操作限时 20 秒；客户端分别为 15/25 秒。
基本查询最多重试一次，live 和管理操作不重试。
日志仅包含请求编号、操作类别、状态、耗时与错误码。

资源字段按服务商文档的 bytes / KiB 转换。平均负载不等于 CPU 使用率，
映射磁盘容量不代表 VPS 内文件系统已用或剩余空间。
OpenVZ 或缺失/无效的可选指标显示未知，不影响有效的流量配额。

历史接口为 `getRawUsageStats`，时间范围在面板端筛选，不向上游传入未经确认的参数。
原始网络样本单独展示，不用于计算月度计费流量、区间增量、实时速率或预测。
未提供的历史不补造，样本间隔变化不补零。每个范围最多展示、导出最近 5,000 个样本。
页面时间使用北京时间，CSV 时间使用 UTC，携带字节单位、原始样本语义和来源。
已只读核对目标 VPS 的真实历史 `data` 与审计 `log_entries` 结构。
其他不兼容的上游结构返回明确提示；原始样本的区间计数语义尚未用于推算。

固定服务端目标的面板命令复用 Upstash 保存，按 origin 与 VEID 隔离，
保留最近 90 天、最多 200 条；服务商审计最多显示 200 条。
同一请求编号的提交和结果只保留一条记录，区分受理、拒绝和未知，不把受理当完成。
记录不包含 API Key、IP、操作者或上游原始描述；存储失败单独提示，操作不自动重发。
浏览器临时凭证模式只提供本次会话面板记录，不保存跨会话命令历史。

## 验证与限制

`pnpm check` 执行实际 ESLint、TypeScript、Vitest 与 Node 生产构建；
CI 额外构建 Vercel 产物。单元测试全部使用模拟上游，不操作真实 VPS。
浏览器验收使用 ego-browser，并将实际页面证据提交给 TypeSafe API 判断。
辅助脚本为 `scripts/browser-evidence.mjs`；其 API Key 只从验证进程环境读取。

vinext 的 Vercel 路径依赖 Nitro；当前 Nitro 版本标记为 beta。
本地构建和功能测试不能代替 Vercel 上的真实发布验证。
依赖审计剩余 `braces` 的未修补高危告警来自 vinext 的构建 glob 工具链，
未发现进入本项目 HTTP 请求路径；后续应跟进上游补丁，避免处理不可信构建配置。
`fflate` 已通过精确 override 升至修补版本。

审查依据与逐项进度见 [项目改进方案](docs/PROJECT_IMPROVEMENT_PLAN.md)。
扩展范围见 [功能扩展方案](docs/FEATURE_EXPANSION_PLAN.md)。
本批测试与浏览器证据见 [功能验收记录](docs/FEATURE_VALIDATION.md)。
