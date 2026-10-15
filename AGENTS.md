# omp-usage — Agent 指南

## 项目定位

OMP 扩展，用于在 OMP 会话中显示多个 provider 的额度。数据源分两类：OMP 未内置 usage 查询的 provider 走本地注册表（独立声明认证读取、接口地址、响应解析，不得改动已有 provider 的解析代码）；OMP 已内置 usage provider 的直接复用 `omp usage --json` 报告，不自写抓取。当前接入 `zhipu-coding-plan`（智谱 BigModel CN / GLM Coding Plan，注册表类）和 `alibaba-token-plan`（阿里云百炼 Token Plan / Qwen，内置报告类，需先 `omp login alibaba-token-plan` 拿到 console session，仅 API key 查不到额度）。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 扩展入口。向 `ExtensionAPI` 注册 provider 与状态栏额度条 widget；按 `ctx.model.provider` 分流数据源：智谱模型走注册表 `fetchUsage`，openai 系和 `alibaba-token-plan` 模型走 `omp usage --json --redact` 内置账号报告（报告选择精确同名优先、`openai`→`openai-codex` 前缀匹配，绝不跨 provider 兜底）；凭据通过子进程 `omp token <providerId> --raw` 读取，只驻留内存。额度按数据源本地缓存 5 分钟，失败（包括 429）指数退避（60 秒起步、封顶 30 分钟）；2 秒轮询检查 provider 变化和缓存过期 |
| `src/status-line.ts` | 额度条渲染：单行紧凑条（窗口标签 + 10 格条 + 百分比 + reset 倒计时），并显示内置账号报告中的可用重置卡数/最近到期时间；颜色取 OMP 主题语义色（success/warning/error/dim） |
| `src/provider-registry.ts` | 注册表。`UsageProviderDefinition`（`id` / `baseUrl` / `api` / `fetchUsage`），OMP 未内置 usage 的新 provider 从这里开始 |
| `src/usage.ts` | 智谱领域逻辑：`parseZhipuUsage`（解析）、`fetchZhipuUsage`（请求）；`parseBuiltinUsageReports` 解析 `omp usage --json` 内置账号报告，只取额度窗口与重置卡数量/到期时间，账号与套餐字段一律丢弃 |
| `test/usage.test.ts`、`test/status-line.test.ts` | 回归测试，全部使用确定性夹具和注入的 `fetch` |
| `test/refresh.test.ts` | 额度刷新退避策略测试 |
| `test/routing.test.ts` | 数据源分流与内置报告选择测试（mock `pi.exec`） |

## 智谱接口领域知识（改动解析逻辑前必读）

历史 bug 都出在对接口字段语义的误判上，以下语义已被回归测试固定，不要"顺手简化"：

- **`percentage` 是 0..100 的整数**：`percentage=1` 表示 1%，不是 100%。仅当响应完全没有绝对计数（`usage` / `currentValue` / `remaining` 全缺失）时，才把 0..1 值按小数兼容处理（`normalizePercentage` 的 `allowFraction` 参数）。
- **窗口 `unit` 枚举**：`1`=天、`3`=小时、`6`=周（天数 = `number * 7`）。`TIME_LIMIT` + `unit=5` + `number=1` 表示**月度工具调用额度**，不是 5 分钟；`unit=5` 且 `number≠1` 才是分钟窗口。
- **指标类型**：`TIME_LIMIT` → tool calls（requests），`CREDIT_LIMIT` → credits，其余默认 tokens。
- **绝对计数优先于百分比**：`limit` 可由 `current + remaining` 推导，`used` 可由 `limit - remaining` 推导；纯百分比时单位降级为 `percent`。
- **窗口按 `durationMs` 升序输出**（5h 在 7d 前），不依赖接口返回顺序——线上接口 7 天在前。
- **窗口标签用英文**（`"5 hours"` / `"7 days"`），与 OpenAI 面板显示保持一致。

## 约定

- **错误处理**：错误码 / `undefined` 返回，不抛业务异常，不伪造零额度。接口不可用、凭据无效、响应无可识别额度时，额度条静默隐藏。
- **凭据安全**：API 密钥永不持久化、不写入日志或通知。
- **测试**：解析或渲染行为的任何变更必须补回归测试；测试绝不请求真实智谱接口。
- **代码风格**：TypeScript `strict` / ES2022 / ESM，相对导入带 `.js` 后缀。`src/usage.ts` 为 4 空格缩进，其余文件为 2 空格，编辑时遵循所在文件现状。
- **注册表报告是给 OMP 消费的**：`UsageReport` 里 `metadata.planType`（面板显示 `plan: lite`）、`limit.label`、`amount.used/limit/unit`、`window.resetsAt` 都由 omp usage 面板直接读取，删掉会掉面板信息——判定"未使用"前先跑 `omp usage` 看实际输出。
- **OMP 卡片/面板的文本扩展改不了**：alibaba 卡片与 `omp usage` 面板里的 `Monthly Credits` 是 OMP 内置 provider 的标签。实测注册同名 provider 的 `usage` 并不替换它，而是**叠加**一条 meter（面板出现两条 meter、capacity 按凭据重复计数、`plan` 等归属错乱），所以别走这条路；命名统一只在我们自己的额度条里做（`src/status-line.ts` 的 `WINDOW_ID_ALIASES`）。

## 常用命令

```bash
bun install          # 安装依赖
bun test             # 运行测试
bun run typecheck    # tsc --noEmit
```

链接到本地 OMP 并自检（改动入口或清单后需要重启 OMP 生效）：

```bash
omp plugin link --scope user /Users/fatedeity/code/omp-usage
omp plugin doctor --scope user --fix
```

真实验证：在**已加载本扩展的 OMP 会话**中观察输入框上方的额度条。注意：独立 `omp usage` 子命令不会加载显式扩展路径，不能用它验证本扩展。

## 新增 provider 流程

1. 先查 OMP 是否已内置该 provider 的 usage（跑 `omp usage --json` 看是否出现报告）；已内置则只需在 `src/index.ts` 的 `sourceKey` 分流中加一个内置报告桶，**不要**在注册表重复实现；
2. 未内置的，在 `src/provider-registry.ts` 的 `PROVIDER_DEFINITIONS` 中添加注册定义；
3. 为新 provider 实现独立的 `fetchUsage`（认证方式、接口地址、额度字段都可能不同，不要假设与智谱一致）；
4. 为响应解析和格式化补充回归测试；
5. 同步更新 README 的"当前支持"列表。

## 前置条件

OMP `>= 18.2.6`（`peerDependencies` 对齐），且对应 provider 已配置凭据；`alibaba-token-plan` 还要求已执行 `omp login alibaba-token-plan`（额度依赖百炼 console session，仅 API key 时内置报告会缺席，额度条静默隐藏）。
