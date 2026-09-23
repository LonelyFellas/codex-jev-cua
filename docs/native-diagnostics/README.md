# 原生调用诊断、状态复用与硬预算

## 结果不是一个布尔值

原生工具的 `details.diagnostic` 与 `cua_status.lastDiagnostic` 包含：

| 字段 | 含义 |
|---|---|
| actionOutcome=not_dispatched | 本地校验/预算/桥接预检阻止派发 |
| actionOutcome=call_returned | 动作 RPC 正常返回，不代表目标达成或实际界面一定改变 |
| actionOutcome=unknown | 动作可能已执行，但未取得可靠的成功返回；禁止自动重试 |
| actionOutcome=not_applicable | 只读调用，不涉及动作 |
| observationOutcome=available | 有可使用的状态与 stateId |
| observationOutcome=not_reusable | 有返回但不足以安全签发下一动作状态；须显式观察 |
| observationOutcome=unavailable | 观察不可用或调用失败 |
| observationOutcome=not_attempted | 尚未进入观察/桥接阶段 |

错误以 `CUA diagnostic: {...}` 结构化文本和 Error 的 diagnostics 属性输出，不回显服务任意错误正文。code= `no_windows_available` 只说明服务返回了该错误，**不证明 Escape 未执行，也不证明窗口关闭成功**。当 Sky 把动作与后续取状态封装在一个 RPC 内时，本插件无法从错误拆出隐藏的动作收据。

Jev `runTask` 结果增加 `diagnostic`：当 driver 动作调用返回成功、但后续独立 observe 失败时，保留 `actionOutcome=call_returned` 和 `observationOutcome=unavailable`。旧 `outcomeUnknown` 仍表示最终效果未知，不能据此重放。

## 少一次重复读取

首次调用 `cua_get_app_state`。动作返回只有同时满足以下条件，才会签发**新** stateId：

- RPC 无错误、无拒绝/取消审批、无已知状态变化错误；
- 原生 `App=` 头的 bundle ID/PID 与前一状态相同；
- 完整 Window 头、0 standard window 根、唯一有效元素索引；
- 返回有截图，文字未截断、不是识别到的差分/局部状态。

随后 Agent 必须阅读动作返回的状态；如状态已足够，可直接使用新 stateId，无需额外 `get_app_state`。任何条件不满足就保守回退到显式观察，不在后台自动重读。

这只是完整结构与身份校验，不保证 UI 原子性或永不变化。旧 stateId 仍单次消费、有效期 60 秒、绑定 app/turn。菜单、局部状态和未识别格式保持原来的显式观察路径，不能靠猜测复用。

## 计时含义

`bridge.timings`：
- `initializeMs`：启动子进程到 initialize 返回的等待。
- `discoveryMs`：tools/list 往返。
- `rpcMs`：目标工具 RPC 往返，含官方内部执行/截图/取状态。
- `approvalMs`：等待官方授权的时间；它是上述阶段的子集，**不要重复相加**。
- `bridgeTotalMs`：本次桥接调用总耗时。

工具诊断还包含 `formatMs`、`toolElapsedMs`、`betweenCallsMs`。调用间隔包含主模型规划、其他工具和用户等待，**不是纯模型延迟**。冷启动与热调用应分开看；不能从单次任务总耗时判断 Sky 点击速度。

诊断不保存 UI 正文、截图、输入文本、任意服务报错正文或 API key；仍适用 pi 原有会话记录。不会额外生成完整轨迹文件。

## 硬预算

- 每个 agent turn 从首次桌面请求开始共用 **180 秒 / 30 次动作尝试**，native 与 Jev 都受约束。
- 调用间隔、用户审批等待、初始化与网络等待均计入总时间。
- 到期在途请求被取消、连接关闭，后续调用在派发前被拒绝。取消不等于动作撤销；派发后的结果可能未知。
- 动作数消耗保守，桥接预检或服务拒绝也不自动退还。动作数耗尽但时间尚存时允许读状态以验证最后结果。
- 状态查询不启动预算；切模式、切应用、重连不会重置预算。新的 agent turn/session 才是新边界，不应主动新建 turn 来规避任务限额。
- 同一 turn 内多个自然语言子任务不会各得一份预算。正式基准每槽独立 turn/session；原先同一长会话 turn 串行完成全部六项的冒烟流程不可用于测这项预算。

基准录入也会拒绝超过 180 秒/30 动作仍标为 success 的记录；超预算失败仍可保留原始耗时与动作数。总耗时记录应在最终验证后立即结束，避免把编写报告的时间混入执行延迟。

## 验证边界

离线测试覆盖进程协议、返回状态复用、预算取消与结果分类。模拟例中两个连续动作只需 `get_app_state → action → action` 三次桥接调用，而非五次。**这证明减少调用次数，不是实测速度提升百分比。**

当前加载的 npm 插件不会随源码更改更新；要做新版本的真实 TextEdit/Chrome 验收，需先明确安装此 checkout、reload 并核对来源。未经该步骤不能用当前桌面工具结果冒充新代码验收。
