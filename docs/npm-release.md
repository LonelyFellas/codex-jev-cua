# npm 分发准备

依据：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md

## 包结构

- npm 名称：`jev-codex-cua`；当前版本：`0.1.0`，实验原型。
- `keywords` 包含 `pi-package`。
- `pi.extensions` 明确指向 `src/pi-extension.ts`，pi 用自身 TypeScript loader 加载。一个包提供默认 native 与显式 jev 两模式，命令 /cua-mode 控制，不发布两套重复引擎。
- `pi.skills` 指向 `skills/`，包含运行 Skill 和单应用授权 Skill。
- 宿主 pi 包与 typebox 按官方约定使用 `peerDependencies: "*"`，不打包宿主副本。项目开发依赖独立锁定版本用于检查。
- 目前没有额外第三方运行时依赖。后续如增加，须放入 dependencies，不能只放 devDependencies。
- `files` 白名单包含源码、编译产物、Skills、所需 fixtures、文档和来源/MIT 授权；不包含密钥、应用授权文件、轨迹、测试、node_modules。
- `prepack` 构建 dist，安装包不需要消费者再运行 TypeScript 编译或 install/postinstall 脚本。

## 本地发布门禁

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:package
```

`test:package` 使用真实 npm pack/prepack，安装生成的 tarball 到临时目录，再通过 pi 加载器验证 14 个注册工具、模式命令和 2 个 Skill，并验证编译后 API。安装采用 omit=dev、ignore-scripts、offline；legacy-peer-deps 仅用于模拟由已有 pi 提供 peer 的消费者，避免在隔离目录安装第二份宿主。该测试不等于 registry 发布验收，不修改用户 pi 设置，不调用 Jev 或桌面应用。

`prepublishOnly` 会运行检查、测试和打包验收；不要用 ignore-scripts 跳过发布门禁。

## 发布授权与来源

维护者已确认公开发布 `jev-codex-cua@0.1.0`，新增代码采用 MIT；第三方 ISC/MIT 声明及原桥接版权保留在 NOTICE.md、THIRD_PARTY_LICENSES.md 和原授权文件中，不补造上游版权归属。已移除 private 发布锁。

首次发布使用已登录的 `darwish-yu` 账号。从已提交的版本执行发布，不把含未确认改动的工作区作为正式发行源。只有 registry 查询确认对应版本后才报告发布成功；npm 的身份验证/二次验证必须正常完成。

```bash
# 在许可、版本和发布范围已确认后，发布门禁会自动执行
npm publish --access public
```

若 npm 要求浏览器验证或一次性验证码，由账号持有人完成，不把 token/OTP 发到聊天或写进源码。

## 发布后的安装和升级

以下命令只有在 registry 上的对应版本真实存在后才可使用：

```bash
pi install npm:jev-codex-cua
# 或固定版本
pi install npm:jev-codex-cua@0.1.0
```

安装后 pi `/reload`。固定版本不会随批量更新自动升级；升级固定版本用新的 `pi install npm:jev-codex-cua@<version>`。非固定版本可用 `pi update npm:jev-codex-cua`。

## 凭证与现有本地安装

不要把密钥和追加应用授权长期放在 npm 包目录中，包升级可能替换该目录。使用包外的私有环境文件，设置 `JEV_CUA_ENV_FILE` 为绝对路径；相邻 `.apps.json` 授权文件也留在包外。配置文件权限 600。

Native 无需 TypeSafe Key，但两种模式仍共同使用应用白名单。对当前本地安装，可暂时将 `JEV_CUA_ENV_FILE` 指向已有私有文件，不读取、不复制其内容。确认 npm 版安装成功后再用 `pi remove <原本地包路径>` 移除重复来源，最后 `/reload`，避免两份扩展重复注册同名工具。发布准备不会自动移动凭证、删除原包或切换安装来源。
