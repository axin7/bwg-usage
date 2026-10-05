# 第一批功能验收

日期：2026-10-05。范围：资源总览、原始流量趋势及 CSV、操作记录。
连接工具、恢复点列表、通知、预测和后台采集未纳入本批。

## 工程检查

- `pnpm check`：ESLint、TypeScript、340 项测试与 Nitro Node 构建通过。
- `pnpm build:vercel` 与 `pnpm verify:vercel`：构建及编译后集成验证通过。
- 新历史接口覆盖匿名拒绝、跨站拒绝、分布式限流故障与 no-store 响应。
- 资源数据保留、目标隔离、审计实际结构及记录存储故障均有定向回归测试。
- 状态文案最后调整后，相关 6 项 UI 测试及 ESLint 通过。
- 代码尺寸检查通过：文件不超过 500 行、函数少于 50 行、行长少于 100 字符。

## 真实服务商契约

通过已登录 KiwiVM 会话进行只读核对，没有执行启停或其他服务器管理操作。
密钥仅用于进程内读取，未输出、写入项目配置或存入验收证据。

- `getRawUsageStats`：真实返回 `data` 对象数组，字段为 `timestamp`、
  `network_in_bytes`、`network_out_bytes` 等；目标当时返回 15,212 个历史样本。
- `getAuditLog`：真实返回 `log_entries`，包含 `timestamp`、`type`、
  `summary`、`requestor_ipv4`；目标当时返回 455 条记录。
- 审计只输出白名单分类和固定说明，数值类型不推断成功，IP 与原始摘要不输出。
- 流量仍按原始样本显示，未根据未知计数语义计算区间用量、速率或预测。

## 浏览器验收

使用 ego-browser 的同一 TaskSpace（27），测试编译产物。
浏览器 API 使用合成样本；验收服务器阻止外部请求，不会因模拟失效操作真实 VPS。
每个完成用例都将实际页面证据提交至 TypeSafe API，并检查真实返回。
下表 11 项最终用例均为 HTTP 200、模型 `jev-1.13.0`、判定 `pass`。

| 最终用例 | 页面证据 | TypeSafe |
| --- | --- | --- |
| `feature-overview` | 配置/可用内存、负载与限速；基本刷新保留实时值及采集时间 | pass |
| `feature-traffic-chart-final` | 进入前无历史请求；进入后两条非空曲线、缺失/零值与覆盖时间 | pass |
| `feature-traffic-csv-final` | 浏览器生成的 5 行 CSV，UTC、来源、字节单位与原始样本语义 | pass |
| `feature-range-cancellation-final` | 旧 7 天请求已取消，迟到的 999 MiB 样本未覆盖 30 天的 4 MiB | pass |
| `feature-history-stale` | 刷新超时后仍有旧流量值和覆盖时间，并显示过期 | pass |
| `feature-audit-filter-final` | 3 条记录筛为 1 条未知停止记录；筛选不增加请求 | pass |
| `feature-audit-outcomes` | 服务商已记录、面板已受理与结果未知分别展示 | pass |
| `feature-audit-stale` | 失败提示与过期状态可见，旧记录和请求编号保留 | pass |
| `feature-mobile-keyboard` | 390px 三视图无页面横向溢出；方向键加 Enter 可切换标签 | pass |
| `feature-final-chart-evidence2` | 最终构建的移动图表非空，时间刻度精确至分钟，无页面溢出 | pass |
| `feature-final-audit-labels` | 登录/API 的固定中文分类，均标为已记录 | pass |

原始证据与模型概率保留在 `/tmp/bwg-usage-validation/<用例名>.json`。
截图包括 `feature-overview-desktop.png`、`feature-traffic-desktop.png`、
`feature-audit-desktop.png`、`feature-final-mobile-chart.png` 等同目录文件。

较早的 CSV、取消、审计筛选和最终图表尝试被判定证据不足，未计为通过。
较早的 `feature-traffic-chart` 被判 fail：用例误限定只读一次，
而浏览器从官方页返回时按设计重新读取。修正验收条件并补齐前后证据后重新验证。
这些未通过的原始记录仍保留，不覆盖、不删除。

本地结果不代表已在 Vercel 发布；没有提交代码或自动部署线上版本。
