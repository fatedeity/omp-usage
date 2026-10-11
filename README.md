# omp-usage

一个用于在 OMP 会话中显示多个 provider 额度的扩展。

项目采用 provider 注册表设计。每个 provider 独立声明认证读取方式、接口地址、响应解析和额度展示逻辑，新增 provider 时不会改动已有 provider 的解析代码。

## 当前支持

当前已接入：

- `zhipu-coding-plan`：智谱 BigModel CN / GLM Coding Plan。

后续 provider 应分别实现自己的额度接口和认证方式。不能假设所有 provider 都使用相同的 API、凭据或额度字段。

## 智谱 provider

当前智谱 provider 请求：

```text
GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
Authorization: Bearer <API 密钥>
```

支持显示：

- 滚动 5 小时 Token 或额度；
- 7 天 Token 或额度；
- 月度工具调用额度；
- 额度重置时间；
- 智谱返回的套餐等级。

扩展不会记录或持久化 API 密钥。认证仍然使用 OMP 为对应 provider 解析出的已有凭据。

## 前置条件

- OMP `18.2.6` 或更高版本；
- 已配置对应 provider 和凭据；
- 对应 provider 提供可用的额度查询接口。

## 使用方式

使用扩展启动 OMP：

```bash
omp --extension /path/to/omp-usage
```

额度条会自动显示（见下文「状态栏额度条」），无需手动执行任何命令。凭据通过 `omp token` 读取，只保存在内存中，不会出现在日志里；接口不可用或凭据无效时额度条静默隐藏，不会伪造为零额度。

## 状态栏额度条

扩展以 widget 在**输入框正上方一行、右对齐**显示额度条，无需任何 OMP 配置。额度条**跟随当前活跃模型的 provider**：

- 智谱模型（`zhipu-coding-plan`）→ 显示智谱 GLM Coding Plan 的额度窗口；
- OpenAI 系模型 → 显示内置账号（如 `openai-codex` 的 ChatGPT 订阅）的额度窗口（当前接口为 `30d` 月窗），数据来自 `omp usage --json --redact`，账号字段被剥离；
- 其他 provider 暂无数据源，额度条隐藏。

切换模型后最多 2 秒额度条自动换源；启动/切换会话和每轮对话结束也会触发刷新。

```text
5h ██████░░░░ 64% 2h14m  7d ███░░░░░░░ 31% 4d6h
```

每段为「窗口标签 + 10 格条 + 已用百分比 + reset 倒计时」，实心块按已用比例填充：
OpenAI 报告若含可用重置卡，会以绿色附加显示数量与最近到期倒计时，例如：

```text
30d ██████████ 95% 27d  ✦ 2 · 12d
```

颜色跟随 OMP 当前主题的语义色（亮度/暗色主题都适配）：

| 主题色 | 已用比例 |
|---|---|
| `success` | < 60% |
| `warning` | 60–85% |
| `error` | > 85% |

reset 倒计时着主题 `dim` 色，格式尽可能紧凑（`45m` / `2h14m` / `4d6h`，零分量省略）；缺失或已过期时省略。数据按来源本地缓存 5 分钟；缓存过期后自动拉取，接口失败（包括 429）按 60 秒起步、逐次翻倍、最长 30 分钟退避并保留旧数据。2 秒轮询只检查 provider 变化和缓存是否过期，不会每 2 秒请求接口。

> 说明：把条放进状态栏 segments 行内需要上游 [PR #9021](https://github.com/can1357/oh-my-pi/pull/9021)（`registerStatusLineSegment` API）合并并升级 omp 后才能实现。

如果希望在每次 OMP 会话中自动加载，可以在 `~/.omp/agent/config.yml` 中配置扩展路径：

```yaml
extensions:
  - /path/to/omp-usage
```

修改配置后请重启 OMP。

## 开发

```bash
bun install
bun test
bun run typecheck
```

测试使用确定性的响应夹具和模拟 `fetch`，不会请求智谱接口。

新增 provider 时，请在 `src/provider-registry.ts` 中添加注册定义，并为响应解析和格式化行为补充回归测试。

## 打包

`package.json` 通过 `omp.extensions` 字段声明扩展入口，因此可以直接从代码目录加载、使用 OMP plugin link 建立链接，或发布到 npm。
