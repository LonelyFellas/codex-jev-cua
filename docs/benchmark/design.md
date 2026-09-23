# 基准设计

- `scripts/benchmark-core.ts`：版本化固定任务集、批次生成、严格输入校验、纯函数聚合。
- `scripts/benchmark.ts`：`init <config.json> <batch.json>`、`record <batch.json> <slot-id> <result.json> <new-batch.json>` 与 `report <batch.json>`。record 拒绝已记录槽并保留旧批次；生成文件独占创建且权限 600；report 只读并输出 JSON。无需新依赖。
- `fixtures/benchmark/form.html`：无网络、无外部资源的本地表单；包含延迟加载与确定结果，供真实浏览器手动验收。
- 批次配置锁定模式、执行类型、提交、主模型/Jev 模型、macOS、应用版本、运行时、显示环境、重复次数。每批全任务等次数，首版不提供挑选任务参数。
- 槽状态为 `pending | success | failed | blocked | cancelled`。终态记录实际开始/结束时间、人工接管次数、模型接管次数、动作次数、错误动作次数、证据引用、验收说明、失败原因。
- 人工接管指用户提供超出预定任务说明的纠错、规划或操作；正常官方授权不计接管，但计入总耗时。Jev → 主模型仅计模型接管。错误动作必须已派发，不能把被拦截的建议计作错误动作。
- 自主成功：success 且 humanInterventions=0 且 wrongActions=0；最终成功允许纠错后成功，单列展示。成功率分母为所有已记录槽（包含 blocked/cancelled）；另给全计划成功占比，未完成时明确 incomplete。
- 耗时按全部已记录运行统计，另列成功样本；采用 nearest-rank P95，小样本不推断泛化能力。空样本返回 null。
- 记录由人填写，校验器只能验证结构与一致性，不能证明真实性或防篡改。固定任务文本也纳入校验，避免旧版本结果被按新任务解释。

首版不修改插件运行路径，不自动插入计时/动作拦截，不将受控验收脚本包装成真实主模型执行。真实运行与证据审核是后续独立步骤。
