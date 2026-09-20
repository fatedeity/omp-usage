# omp-usage-zhipu-coding-plan

一个用于在 OMP 会话中显示智谱 BigModel CN / GLM Coding Plan 额度的扩展。

扩展提供 `/glm-usage` 命令。这是因为 OMP 18.2.6 的独立 `omp usage` 子命令不会加载通过 `--extension` 临时指定的扩展路径。扩展同时注册了 `zhipu-coding-plan` 的额度解析器，供在统计额度前已经加载扩展的宿主使用。

## 功能

扩展会覆盖 `zhipu-coding-plan` 的额度查询逻辑，并请求：

```text
GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
Authorization: Bearer <API key>
```

接口响应会被转换为 OMP 额度信息，包括：

- 滚动 5 小时 Token 或额度；
- 7 天 Token 或额度；
- 月度工具调用额度；
- 额度重置时间；
- 智谱返回的套餐等级。

扩展不会记录或持久化 API 密钥。认证仍然使用 OMP 为 `zhipu-coding-plan` 解析出的已有凭据。

## 前置条件

- OMP `18.2.6` 或更高版本；
- 已配置 `zhipu-coding-plan` 提供商和 API 密钥；
- 智谱 BigModel CN / GLM Coding Plan 账户。

## 使用方式

使用扩展启动 OMP：

```bash
omp --extension /path/to/omp-usage-zhipu-coding-plan
```

进入会话后执行：

```text
/glm-usage
```

命令会通过 `omp token` 读取已经配置的 `zhipu-coding-plan` 凭据，请求智谱接口，并显示套餐、当前用量、剩余额度和重置时间。API 密钥只保存在内存中，不会出现在通知或日志里。

如果希望在每次 OMP 会话中自动加载，可以在 `~/.omp/agent/config.yml` 中配置扩展路径：

```yaml
extensions:
  - /path/to/omp-usage-zhipu-coding-plan
```

修改配置后请重启 OMP。

独立命令：

```bash
omp usage --provider zhipu-coding-plan
```

在当前 OMP CLI 中不会加载显式扩展路径。请在已经加载本扩展的会话中使用 `/glm-usage`。如果未来 OMP 版本允许 `usage` 子命令加载已安装扩展，当前注册的提供商额度解析器也可以直接支持该流程。

当接口不可用、API 密钥无效，或响应中没有可识别的额度时，命令会提示额度不可用，不会伪造为零额度。

## 开发

```bash
bun install
bun test
bun run typecheck
```

测试使用确定性的响应夹具和模拟 `fetch`，不会请求智谱接口。

## 打包

`package.json` 通过 `omp.extensions` 字段声明扩展入口，因此可以直接从代码目录加载、使用 OMP plugin link 建立链接，或发布到 npm。
