# 来源说明

## pi-codex-cua 桥接

`src/sky/runtime.ts` 与 `src/sky/client.ts` 改编自 https://github.com/manaflow-ai/pi-codex-cua ，参考本地提交 `6850a286c399b9b3d483278fe9f602644b101022`，版权归 Manaflow AI（2026）。完整 MIT 授权保存在 `src/sky/LICENSE.pi-codex-cua`，随源码分发。

保留官方签名客户端启动链与 turn metadata，增加超时、取消、协议边界及隐私处理。不包含或再分发 Codex/Sky 私有二进制，仍从用户安装的官方运行时加载。

## Jev-cu 编排

本项目的 AX 解析/候选筛选、Jev 四问、策略门槛、Codex driver 和任务循环参考并改编自 Sac-Y/Jev-cu：

- https://github.com/Sac-Y/Jev-cu
- 参考提交：e2cc92d731fac6e6aeb7acbd3c105cf23552cdec
- 原 package.json 声明：`"license": "ISC"`；`author` 字段为空。
- 此提交未包含单独 LICENSE 文件或版权声明；本文件不补造版权归属或授权文本。若要对外发布，需进一步确认原作者的授权说明。

本次为 TypeScript 迁移与本地开发版本，保留核心设计，增加类型和部分失败关闭校验。未声称与上游完全等价或性能优于上游。
