# Claude Code native MCP

- 提供独立 stdio MCP 入口，仅暴露 native 桌面工具、状态、任务开始/结束；不接 Jev，不依赖 pi 宿主，不修改现有 Claude 配置。
- 复用 SkyClient、stateId 校验、状态复用、分段诊断与 TaskBudget；保留应用范围及官方批准。
- MCP 无 agent turn 事件，改为显式 taskId：开始任务需通过 MCP form elicitation 由用户确认；一次 180秒/30动作预算，不允许活动任务覆盖；新任务必须重新确认。
- 官方 Sky 批准独立转交客户端 elicitation；无能力、拒绝、取消、超时均拒绝，不用工具参数 approved=true 代替用户同意。未知动作结果终止当前任务，不自动重放。
- 本地用户配置使用稳定包外目录；不继承项目 cwd 配置、不修改 pi 配置、不回显密钥。
- 不自动运行付费 Claude 模型、不接触真实桌面来冒充验收；离线协议测试与 Claude 实机验收明确区分。
