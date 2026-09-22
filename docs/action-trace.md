# 完整动作轨迹

## 目的与边界

本次改动只增加观测证据，不改变决策目标、风险/置信度门槛、步数预算、候选筛选、操作历史长度或任务推进方式。针对 12 + 30232 的失败，不再通过加步数或调门槛试跑。

过去未开启完整记录的执行无法事后还原。测试中的“反复清空最终只显示 12”是人为构造的失败场景，用于验证轨迹完整性，**不是实际失败原因的结论**。

## pi 使用

`/reload` 加载更新后，给 `jev_cua_run` 增加 `fullTrace: true`，其他输入与待复现任务保持一致。例如继续使用原有 12 步预算，不增加：

```json
{
  "appName": "Calculator",
  "goal": "Calculate 12 + 30232 and show the final result.",
  "dryRun": false,
  "maxSteps": 12,
  "fullTrace": true
}
```

复现还应沿用原计划并记录实际初始界面，不假定初始显示值相同。执行前会弹出包含完整记录说明的确认框；拒绝则不创建日志、不调用 Jev、不执行动作。授权、敏感动作停止规则不变，不因开启轨迹而自动重试。

成功、失败、暂停、dry-run 和预算耗尽均返回 `tracePath`；pi 执行错误文本也包含路径。若记录无法创建，任务在操作前失败。若写入途中失败或达到默认 64 MiB 日志预算，任务停止并报告 `traceIncomplete: true`，不静默丢弃后续事件。这个限制是磁盘记录保护，不是扩大操作预算。

默认路径：包目录 `runs/<UUID>.jsonl`。目录要求当前用户所有、权限 700，不能是符号链接；文件权限 600。`runs/` 已被 Git 忽略且不在 npm 发布文件清单中。日志不自动删除、不自动上传，分析完可手动删除明确指定的文件。

## 记录内容

每行都有 `schemaVersion`、`runId`、递增 `seq`、时间戳及相对起始毫秒数。

| event | 内容 |
|---|---|
| `task` | 应用、目标、计划、资源、原步数/候选预算、验证说明、decider 类型 |
| `snapshot` | 初始/派发前/动作后的完整 AX 文本、快照编号、对应步骤；不是截图 |
| `decision_input` | 当前快照 ID、全部送入决策的候选及标签/角色/索引/分数、截断情况、上下文和历史 |
| `jev` request | 实际发送给 Jev 的 JSON body（四问、候选描述、上下文、模型），不含 Authorization header |
| `jev` response | 成功 HTTP 响应的解析后 JSON，包括原始 answers、概率分布和 usage；错误 HTTP 仅记状态及重试信息，不保存错误响应正文 |
| `decision_output` | 归一化决策及按当前 AX 解析出的实际目标，早期无效决策也记录 |
| `action_prepared` | 资源及最终准备好的动作和目标；不把“准备好”算作执行成功 |
| `gate` | 策略判定及停止原因 |
| `dispatch_start` | 紧邻实际调用前落盘的 driver 方法和参数、目标原文及派发前快照 ID |
| `dispatch_return` | driver 调用已返回、耗时和返回成功的调用数；不代表业务目标达成 |
| `verification` | 验证是否启用、使用哪张快照、返回结果 |
| `failure` | 出错步骤和阶段、错误名称/文本、是否结果未知 |
| `outcome` / `finish` | 终止状态、已返回的动作数、验证结果及停止原因 |

自定义 decider 仍记录 decision_input/output，但没有虚构的 Jev HTTP 交换。记录的是实际 driver 层动作调用，不是全部原生 IPC 报文。中断前未返回的调用会有 dispatch_start 而没有 dispatch_return；后续读取失败不能被误认为动作没发生。

## 隐私

完整模式会保存目标、界面文字、输入内容、模型看到的历史和模型回答；必须显式同意。默认关闭，原 `traceDir` 元数据模式保持不保存这些正文。

不序列化进程环境、JevOptions、请求 headers、截图。已配置的 TypeSafe API key 会在所有记录中替换为 `[REDACTED]`，包括意外出现在响应、错误或界面文本中的相同值。其他应用里的敏感信息并不因此自动脱敏，仍应保护日志。

## 分析方法

1. 先确认 task 中的目标、计划与预算，检查是否有终止记录和 traceIncomplete。
2. 按 step 对齐 decision_input → Jev 请求/回答 → decision_output → gate，确定是模型选错、候选缺失、归一化问题还是策略阻止。
3. 对齐 dispatch_start 的目标标签、索引和快照；索引仅属于那张快照，不跨步骤解释。
4. 检查 dispatch_return 和 after_action 快照。如果调用成功但界面不符合预期，再定位执行、焦点、刷新时机问题。
5. 查看下一步实际发送的 recent_actions/context，判断是否正确反映已完成动作，避免把“可能丢失进度”当作已经证实的原因。
6. 最终以 AX 中实际表达式和结果为准；model_done、changed、调用成功或预算耗尽都不是验收通过。

只有拿到真实复现轨迹后再决定修复，不依据模拟轨迹推断实际点击序列。
