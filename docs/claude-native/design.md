# 设计

- 使用官方 @modelcontextprotocol/sdk 1.x Server + StdioServerTransport；stdout 仅协议，stderr 仅脱敏诊断。进程关闭取消请求并关闭 Sky。
- 从 native-tools 分离共享工具定义，避免 MCP 入口加载 pi-ai/pi-coding-agent。共享有界文本截断放入独立模块，行为用原有测试回归。
- NativeMcpSession 管理串行锁、taskId、budget、snapshot、connection。动作与读取要求 taskId；status 无桌面副作用。task_begin 向宿主发带明确布尔确认字段的 elicitation；接受且 confirm=true 才开始。Sky 的官方批准使用独立相同确认机制，原始授权消息仅展示给用户，拒绝不继续。
- 取消/超时/异常终止任务，保留结构化诊断。预算在 begin 的用户确认完成后启动；官方 Sky 授权等待计入预算。task_end 不撤销已执行动作，只销毁状态。新任务始终需要重新用户确认，不能靠模型重建任务自动续期。
- 配置路径为 DESKHAND_CONFIG_FILE 或 ~/.config/deskhand/cua.env；读取现有配置/授权文件格式但强制 native，不加载 Jev 决策器。不自动创建配置或扩权，默认仅 Calculator；允许用户显式设置 all。
- npm bin deskhand-mcp 指向 dist/mcp/cli.js，pi peer dependencies 改为 optional，typebox 为运行依赖。SDK Client + 内存/stdio 传输测试握手、发现、status、校验、生命周期与拒绝授权；fake Sky 测试动作与取消，无桌面访问。
- 安装说明使用源码 build 后的绝对 CLI 路径，不推荐尚未发布的 npm 版本。Claude Code 的 MCP 文档说明支持 form elicitation；具体本机交互验收仍待用户配置后执行。
