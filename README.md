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

进入会话后执行：

```text
/omp-usage
```

不传参数时查询当前注册表中的第一个 provider。也可以指定 provider：

```text
/omp-usage zhipu-coding-plan
```

使用 `all` 进入聚合模式，同时显示注册表 provider 和 OMP 内置账号（如 `openai-codex` 的 ChatGPT 订阅）的额度：

```text
/omp-usage all
```

聚合模式通过 `omp usage --json --redact` 透传内置账号报告，凭据刷新与缓存由 OMP 处理；扩展已覆盖的 provider 不会重复显示，metadata 中的账号字段（邮箱、账号 ID 等）会被剥离。

命令会通过 `omp token` 读取对应 provider 的凭据，请求额度接口，并显示套餐、当前用量、剩余额度和重置时间。凭据只保存在内存中，不会出现在通知或日志里。

如果希望在每次 OMP 会话中自动加载，可以在 `~/.omp/agent/config.yml` 中配置扩展路径：

```yaml
extensions:
  - /path/to/omp-usage
```

修改配置后请重启 OMP。

在当前 OMP CLI 中，独立 `omp usage` 子命令不会加载显式扩展路径；请在已经加载本扩展的会话中使用 `/omp-usage`。

当接口不可用、凭据无效，或响应中没有可识别的额度时，命令会提示额度不可用，不会伪造为零额度。

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
