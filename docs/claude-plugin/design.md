# 设计

仓库提供 marketplace，插件根目录为 `plugins/deskhand`，不暴露 pi 专用 Skills。Plugin `.mcp.json` 通过 npx 启动固定同版本 npm MCP；Skill 随 Plugin 缓存与更新。使用已有 npm 发布产物，避免另建安装器或运行时构建步骤。

版本唯一运行时来源是 package.json；MCP 握手和 status 共用。`checkUpdates` 可选布尔参数通过现有 schema 校验；仅 true 时 GET npm latest，5 秒超时并支持请求取消，禁止重定向。只接受正确包名和稳定语义版本，不执行服务端返回内容，不回显可能带凭据的网络错误。输出当前/最新版本及固定 Plugin 升级指引。

分发采用固定版本而非 latest，避免旧 Skill 配新 MCP。代价是发布者必须同步元数据、确认 npm 发布成功；单元测试拦截版本/Skill 漂移。首次启动仍需 Node/npx/网络。旧 MCP/Skill 不自动移除，迁移由用户确认，不修改权限。Claude 实机安装验证与 npm 发布不在本次自动化验收内。
