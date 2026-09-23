# 实施设计

- `SkyClient` 增加本地生成的 diagnostics：请求 ID、method、phase、dispatched、RPC 结果、审批结果、有限错误分类与计时。结构化错误保留诊断，不回显服务任意正文。`noWindowsAvailable` 仅表示服务报告该代码；对于已派发动作仍为 unknown。
- `native-state` 负责输出解码与观察可用性，不推断任务成功。原生错误带 `actionOutcome` 和 `observationOutcome`；包装 JSON-RPC 成功不是最终任务达成。
- 动作返回的状态复用需同时满足：非 isError、无审批拒绝/取消、完整窗口根、唯一索引、非截断、有截图、与上次观察相同 bundle ID 和 PID 的原生 App 头。其他情况不签发 stateId；不自动补读或重试。现有菜单/局部独立读取保持兼容，但不会靠部分动作结果续签。
- `TaskBudget` 在第一个桌面请求前启动，以 monotonic clock 计算截止时间；跨调用间隔计入总耗时。在每个原生请求派发前检查动作数和时间，通过 AbortSignal 取消进行中的共享连接。模式切换/重连不重置，仅 session/agent 新边界重置。
- 工具状态公开剩余预算及最近一次结构化诊断；工具错误保留机器可读诊断文本。格式化失败不将 RPC 已返回事实抹去。错误不提供可复用状态。
- 计时边界明确：bridgeTotalMs 包含 initialize/discovery/rpc/approval；approvalMs 是各阶段内部等待的子集，不可与这些阶段相加；betweenCallsMs 包含模型规划、用户等待和其他工具，不能称作 modelLatency。无法拆出官方内部动作/截图时间，使用 rpcMs 并说明不可观测。
- 不新增桌面工具数量；更新原生工具说明与 skill，允许使用合格动作返回的新 stateId。旧 token 单次消费、60 秒有效、同 app/turn 约束不变。

验证覆盖：派发前失败、派发后超时、无窗口服务错误、拒绝授权、完整/部分/跨应用返回状态、重复索引、复用状态的顺序动作、截止时间、审批等待超时、动作预算、模式切换无法续期、基准超预算成功拒绝。进程级模拟仅证明协议行为，不冒充真实桌面根因复现。
