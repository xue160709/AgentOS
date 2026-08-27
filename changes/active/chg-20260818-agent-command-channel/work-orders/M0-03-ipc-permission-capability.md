# M0-03｜Typed IPC、Permission 与 Sender Capability

## 目标

通过 `window.projectChat` 暴露 broker，所有 IPC 验证 sender/frame/project；把权限模式迁到 Main app-global 持久化并在 submit 捕获。

## 依赖

- `M0-02` 完成。
- 精读 `technical.md §4.1`、`§6`、`§8`。

## Write allowlist

- `src/project-chat-contract.ts`
- `src/desktop-types.ts`
- `electron/preload.ts`
- `electron/electron-env.d.ts`
- `electron/main.ts`
- `electron/project-chat-broker.ts`
- `electron/desktop-preferences-store.ts`
- `electron/project-chat-ipc.ts`（新增，可选）
- `electron/project-chat-ipc.test.mjs`（新增）
- `electron/desktop-seam.test.mjs`
- `electron/claude-agent-runner.ts`

禁止写：React TSX、window manager、binding/deep link、Runtime。

## 实施步骤

1. 完整实现 `ProjectChatAPI` preload adapter；channel 常量集中，不在 renderer 拼字符串。
2. Main capability registry 登记主窗口；提供后续窗口 manager 的 register/unregister 接口。
3. 每个 handler 校验 webContents、main frame、renderer URL、project ownership；统一返回脱敏 `ProjectChatError`。
4. 实现 Main permission 初始化协议：字段缺失时只允许 main-window capability 用 legacy localStorage 合法值初始化一次，无值为 `auto`；字段存在时旧 renderer 不能覆盖。写成功广播 snapshot。
5. broker submit 不接受 renderer 传入 cwd/session/permissionMode；从项目/thread/Main prefs 解析并捕获。
6. 旧 `claude-chat:submit/cancel/new-thread/answer-*` 暂时委托 broker，保留 settings/status/rewind API；不能再直接调用 runner。

## 必测断言

- 未登记 sender、subframe、错误 renderer URL、wrong project 全部 `sender-not-authorized`。
- renderer payload 注入 cwd/session/permission 字段不会进入 runner。
- 两窗口改权限后 snapshot 一致；运行中修改不改变已捕获 mode。
- legacy 非 auto 值首次迁入且只迁一次；项目窗口/迟到旧主窗口不能覆盖 Main 已存值。
- Preview/未知 webContents 无 Chat capability。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-ipc.test.mjs electron/desktop-seam.test.mjs electron/project-chat-broker.test.mjs
```

## 停止并报告

若 Electron 版本无法可靠识别 invoking frame，默认拒绝，不放宽到只看 sender.id。
