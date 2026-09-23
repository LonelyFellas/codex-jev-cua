# 设计

在 Claude MCP 专有工具中加入 `cua_launch_app(taskId, app, identityType)`，`app` 是明确注册应用名（`identityType=name`）或 Bundle ID（`identityType=bundleId`），且与 `cua_task_begin` 的 app 完全相同。显式区分名称和 ID，避免 `zoom.us` 这类名称被当成 Bundle ID。工具复用 NativeMcpSession 的范围校验、串行约束、取消和预算；只对启动豁免旧 stateId 要求，UI 动作仍需当前状态。

本地启动器使用 `/usr/bin/open -b <bundleId>` 或 `-a <name>`（execFile，无 shell、无 URL/文件/额外参数），经 LaunchServices 启动或激活已注册应用。仅 macOS 支持，10 秒超时并绑定任务取消信号。其结果不伪造 Sky 状态或系统权限；无截图/stateId，下一步必须读取窗口。

注入启动器以便离线测试，不在 CI 打开真实应用。失败诊断保留安全的本地阶段/错误类别，不回显进程 stderr。只读请求、授权拒绝或失败不会自动触发启动。应用名称未知时先发现/确认标识，不能临时扩大名单；注册名称和用户所说的本地化别名不一定相同，不能把任意别名解析宣称为必然成功。工具不限制特定应用，不要求用户手动启动。
