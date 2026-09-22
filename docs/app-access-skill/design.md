# 应用范围 Skill：设计

## 存储与优先级

新增 `<envFile>.access.json`，内容仅为 `{ "version": 1, "appAccess": "all" | "allowlist" }`。envFile 仍来自 JEV_CUA_ENV_FILE 或当前包的 .env.local。路径以绝对路径暴露在 cua_status；授权文件不依赖密钥文件存在，但运行时原有配置安全检查不放宽。

优先级：显式授权文件 > JEV_CUA_APP_ACCESS 进程环境 > 私有环境文件 > allowlist。无授权文件时完全兼容现有行为。Skill 的 allowlist 必须能撤销先前环境里的 all，所以不能将授权文件放在环境变量之后。覆盖期间不读取被覆盖的模式值作为实际选择；其他凭据、名单、mode 的校验不变。

独立存储实现复用现有 app-grants 的安全模式（小型 owner-only 普通文件、O_NOFOLLOW、独占写锁、临时文件+fsync+原子替换），不重构现有单应用追加逻辑。读取额外用 O_NONBLOCK，避免异常 FIFO 阻塞。

## 配置与状态

PiConfig 继续输出 appAccess，新增 appAccessFile 和 appAccessSource（grant-file/environment/env-file/default）。只有新加载器能提供这两个字段，Skill 将它们作为能力和配置来源检查，不依赖 UI 中可能固定的版本标签。

appAccessFile 从实际配置路径生成；状态不返回环境文件内容或密钥。native/Jev 共用现有的 loadPiConfig 和 checkApp，不增加桌面工具或风险旁路。

## CLI 与 Skill

新增 src/app-access.ts，构建为 dist/app-access.js；Skill 只调用后者，避免 Node 禁止在 node_modules 中 strip TypeScript 的兼容性问题。npm 消费者不需要编译器：

- `status`：只读取独立授权文件，返回 file 和 storedAppAccess（没有保存时为 null），不声称是完整运行时有效范围。
- `all --expected-file <absolute path>` / `allowlist --expected-file <absolute path>`：将 expected-file 与脚本根据自身安装来源和进程环境计算的路径比较；不接受任意输出路径，不允许重定向目标。验证一致后才写入。
- `--help`：说明范围与限制。拒绝其他参数；错误输出不包含 .env 内容。

Skill 默认 disable-model-invocation，供用户主动 slash 调用；不根据网页/工具报错自动启用。先调用 cua_status，检查新能力、configError、busy，然后用来自本 Skill 安装目录的脚本 status 校对路径；切换后再次调用 cua_status，确认路径、appAccess 和 appAccessSource=grant-file。任何冲突停止，不自行设置环境变量、复制脚本到其他安装或编辑 .env。

原子配置写入不会抢占已经运行的 Jev 循环；Skill 在 busy 时让用户正常等待/取消。官方授权、敏感操作确认、stateId/接管预算和 no-replay 保持原状。

## 验证

- 文件格式、两个模式、幂等、原 .env/.apps.json 字节不变、模式优先级、异常格式/权限/链接/锁、CLI 参数和错误目标。
- 使用不可读凭据文件验证 CLI 不依赖 .env；用合成凭据验证 stdout/stderr 不泄露秘密。
- 同一插件实例加载真实临时配置：保存后下一次调用获取新范围，并在恢复名单后拒绝名单外应用。
- npm pack 的真实 Skill 发现/元数据校验，消费者无开发依赖运行 CLI、持久文件未被打包。
- 执行类型检查、定向及全量测试、test:package；不调用真实桌面或付费 API。
