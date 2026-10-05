# 参与贡献

欢迎提交问题反馈、文档修正和针对现有功能的改进。
提交较大的功能前，请先通过 Issue 说明使用场景和预期行为。
安全问题按 [安全政策](SECURITY.md) 私下报告，不在公开 Issue 中提交利用细节。

## 开发环境

需要 Node.js 22.13.0 或更新的 22.x，以及 pnpm 10.13.1。
使用 nvm 时可运行 `nvm install` 和 `nvm use`，仓库已提供 `.nvmrc`。

```sh
git clone https://github.com/axin7/bwg-usage.git
cd bwg-usage
pnpm install --frozen-lockfile
pnpm dev
```

无需真实 VPS 凭证即可运行单元测试与编译后集成验证。
仅在手动连接真实 VPS 时才需要自己的 VEID 和 API Key。
密码登录和服务端固定目标的配置见 [部署说明](docs/DEPLOYMENT.md)。

## 代码组织

| 路径 | 职责 |
| --- | --- |
| `src/app` | 页面、布局与 HTTP 路由 |
| `src/components/VPSCard` | 配置、查询、操作与总览/历史视图 |
| `src/lib/server` | 上游访问、数据解析、认证、限流与审计记录 |
| `src/lib` | 客户端请求、凭证存储与响应校验 |
| `src/types` | 客户端与服务端共用的数据契约 |
| `tests` | 路由、上游契约及组件集成测试 |
| `scripts` | 编译产物验证与可选浏览器验收辅助脚本 |

采用 React 与 vinext 的 App Router，Vite/Nitro 负责构建和服务端运行。
不要将本项目配置为标准 Next.js 构建，也不要把 API 产物作为静态站点部署。

## 改动约定

- 保持改动范围明确，沿用现有模块与接口，不预先实现尚无使用场景的抽象。
- 单个文件不超过 500 行；函数少于 50 行；行长尽量保持在 100 字符以内。
- 新的外部依赖须直接声明，并随依赖变更提交 `pnpm-lock.yaml`。
- 保留未知、零值、失败和过期数据之间的区别，不用默认值伪造上游数据。
- 管理操作必须保留目标确认；受理不等于完成，超时后不得自动重发。
- 针对错误修复补充有意义的回归测试；上游调用使用替身，避免操作真实 VPS。
- 不提交 API Key、密码、Cookie、环境配置、真实日志或包含私人信息的截图。

## 验证

提交前运行与改动有关的测试。涉及运行时、构建或依赖的改动须完成：

```sh
pnpm check
pnpm build:vercel
pnpm verify:vercel
```

`pnpm check` 包含 ESLint、类型检查、Vitest 与 Node 生产构建。
`verify:vercel` 读取已经构建的 Vercel 产物；须先执行 `build:vercel`。
CI 对分支推送和 PR 执行同样的检查，不需要仓库 Secrets 或真实上游凭证。

浏览器验收使用 ego-browser；仓库证据脚本使用 TypeSafe API 判断验收条件。
仅使用合成凭证和模拟响应，禁止将真实面板内容发送给外部验证服务。
`TYPESAFE_API_KEY` 仅供验收进程使用，不是应用配置，也不应添加到 Vercel 环境变量。
普通测试和构建不需要该密钥。

## 提交 PR

Fork 仓库后创建功能分支，填写 PR 模板，说明问题、最终行为和实际执行的检查。
界面改动附合成数据截图；反馈运行异常时附请求编号、错误码和复现步骤。
提交信息采用 `fix:`、`feat:`、`docs:`、`test:` 或 `chore:` 前缀，简述具体改动。
PR 中不应包含无关格式化、构建产物或未经验证的测试通过声明。
