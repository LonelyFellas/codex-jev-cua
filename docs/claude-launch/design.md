# 设计

## 跨宿主启动

共用 `src/launch-app.ts` 的 LaunchServices 实现。pi native 注册同名 `cua_launch_app`，不依赖 MCP taskId；遵守 appAccess、串行锁及本轮预算，支持 pi 官方取消信号。启动不会创建 Sky 连接或发送 TypeSafe 请求。Jev 模式禁用启动工具，不能用原生接管或模式切换绕过失败；本轮发生取消/致命错误后禁止启动。pi 的枚举 schema 使用 StringEnum 兼容不同模型供应商。

## 通用状态恢复

两端在原生响应明确为 `state_changed`，且没有拒绝/取消/预算到期时，保存 recovery={app, failedMethod, previousActionOutcome}。它不是操作失败证明；已派发操作保持 unknown。只有同应用 get_app_state 能继续，禁止旧 token、跨应用、启动、发现及其他动作；不重置时间或动作预算。

成功观察后清除 recovery，提供新 token 和原操作上下文，由 Agent 根据任意应用当前真实状态决定下一步；结果仍不明确时询问用户，不自动重放。恢复读取再遇 state_changed 时保留最初失败操作，其他异常则停止。系统和 Sky 授权拒绝不会进入此路径。MCP 保留原 taskId；pi 保留本轮预算及手工接管剩余步数。恢复只覆盖原生调用，不自动恢复 Jev 决策循环。

## MCP 任务约束

在 Claude MCP 专有工具中加入 `cua_launch_app(taskId, app, identityType)`，`app` 是明确注册应用名（`identityType=name`）或 Bundle ID（`identityType=bundleId`），且与 `cua_task_begin` 的 app 完全相同。显式区分名称和 ID，避免 `zoom.us` 这类名称被当成 Bundle ID。工具复用 NativeMcpSession 的范围校验、串行约束、取消和预算；只对启动豁免旧 stateId 要求，UI 动作仍需当前状态。

本地启动器使用 `/usr/bin/open -b <bundleId>` 或 `-a <name>`（execFile，无 shell、无 URL/文件/额外参数），经 LaunchServices 启动或激活已注册应用。仅 macOS 支持，10 秒超时并绑定任务取消信号。其结果不伪造 Sky 状态或系统权限；无截图/stateId，下一步必须读取窗口。

注入启动器以便离线测试，不在 CI 打开真实应用。失败诊断保留安全的本地阶段/错误类别，不回显进程 stderr。只读请求、授权拒绝或失败不会自动触发启动。应用名称未知时先发现/确认标识，不能临时扩大名单；注册名称和用户所说的本地化别名不一定相同，不能把任意别名解析宣称为必然成功。工具不限制特定应用，不要求用户手动启动。
