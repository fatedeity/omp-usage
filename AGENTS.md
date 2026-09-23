# omp-usage — Agent 指南

## 项目定位

OMP 扩展，用于在 OMP 会话中显示多个 provider 的额度。采用 provider 注册表设计：每个 provider 独立声明认证读取、接口地址、响应解析和展示逻辑，新增 provider 不得改动已有 provider 的解析代码。当前仅接入 `zhipu-coding-plan`（智谱 BigModel CN / GLM Coding Plan）。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 扩展入口。向 `ExtensionAPI` 注册 provider 与 `/omp-usage` 命令；凭据通过子进程 `omp token <providerId> --raw` 读取，只驻留内存 |
| `src/provider-registry.ts` | 注册表。`UsageProviderDefinition`（`id` / `displayName` / `baseUrl` / `api` / `fetchUsage`），新增 provider 从这里开始 |
| `src/usage.ts` | 智谱领域逻辑：`parseZhipuUsage`（解析）、`fetchZhipuUsage`（请求）、`formatUsageReport`（格式化） |
| `test/usage.test.ts` | 回归测试，全部使用确定性夹具和注入的 `fetch` |

## 智谱接口领域知识（改动解析逻辑前必读）

历史 bug 都出在对接口字段语义的误判上，以下语义已被回归测试固定，不要"顺手简化"：

- **`percentage` 是 0..100 的整数**：`percentage=1` 表示 1%，不是 100%。仅当响应完全没有绝对计数（`usage` / `currentValue` / `remaining` 全缺失）时，才把 0..1 值按小数兼容处理（`normalizePercentage` 的 `allowFraction` 参数）。
- **窗口 `unit` 枚举**：`1`=天、`3`=小时、`6`=周（天数 = `number * 7`）。`TIME_LIMIT` + `unit=5` + `number=1` 表示**月度工具调用额度**，不是 5 分钟；`unit=5` 且 `number≠1` 才是分钟窗口。
- **指标类型**：`TIME_LIMIT` → tool calls（requests），`CREDIT_LIMIT` → credits，其余默认 tokens。
- **绝对计数优先于百分比**：`limit` 可由 `current + remaining` 推导，`used` 可由 `limit - remaining` 推导；纯百分比时单位降级为 `percent`。
- **窗口按 `durationMs` 升序输出**（5h 在 7d 前），不依赖接口返回顺序——线上接口 7 天在前。
- **窗口标签用英文**（`"5 hours"` / `"7 days"`），与 OpenAI 面板显示保持一致；报告正文（标题、重置时间）用中文。

## 约定

- **错误处理**：错误码 / `undefined` 返回，不抛业务异常，不伪造零额度。接口不可用、凭据无效、响应无可识别额度时，命令提示"额度不可用"。
- **凭据安全**：API 密钥永不持久化、不写入日志或通知。
- **测试**：解析或格式化行为的任何变更必须补回归测试；测试绝不请求真实智谱接口。
- **代码风格**：TypeScript `strict` / ES2022 / ESM，相对导入带 `.js` 后缀。`src/usage.ts` 为 4 空格缩进，其余文件为 2 空格，编辑时遵循所在文件现状。

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

真实验证：在**已加载本扩展的 OMP 会话**中执行 `/omp-usage zhipu-coding-plan`。注意：独立 `omp usage` 子命令不会加载显式扩展路径，不能用它验证本扩展。

## 新增 provider 流程

1. 在 `src/provider-registry.ts` 的 `PROVIDER_DEFINITIONS` 中添加注册定义；
2. 为新 provider 实现独立的 `fetchUsage`（认证方式、接口地址、额度字段都可能不同，不要假设与智谱一致）；
3. 为响应解析和格式化补充回归测试；
4. 同步更新 README 的"当前支持"列表。

## 前置条件

OMP `>= 18.2.6`（`peerDependencies` 对齐），且对应 provider 已配置凭据。
