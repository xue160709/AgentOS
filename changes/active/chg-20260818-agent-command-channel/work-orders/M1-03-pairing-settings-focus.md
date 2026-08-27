# M1-03｜Pairing UI、网站连接管理与新任务焦点规则

## 目标

完成用户确认配对、Settings 网站连接管理、external task 的显示/徽标逻辑和项目异常恢复。

## 依赖

- `M1-02` 完成。
- 精读 `design.md §4–6`、`§9–10`。

## Write allowlist

- `src/components/AgentOSPairingDialog.tsx`（新增）
- `src/components/setting/WebsiteBindingsSettingsPage.tsx`（新增）
- `src/components/setting/SettingsPage.tsx`
- `src/components/AppShell.tsx`
- `src/components/AppShellSidebar.tsx`
- `src/components/app-shell-constants.ts`
- `src/components/types.ts`
- `src/components/chat/ProjectChatWindowPage.tsx`
- `src/components/chat/ChatPage.tsx`
- `src/project-chat-contract.ts`
- `src/i18n/i18n.tsx`
- `src/locales/zh.json`
- `src/locales/en.json`
- 与上述组件直接对应的 CSS/test 文件（回报具体路径）
- `electron/preload.ts`
- `electron/main.ts`
- `electron/project-chat-window-manager.ts`
- `electron/project-chat-view-state-store.ts`
- `electron/website-binding-store.ts`
- `electron/agentos-ticket-client.ts`
- `electron/agentos-ticket-client.test.mjs`
- `electron/agentos-pairing.ts`（新增，可选 Main-only orchestration）
- `electron/agentos-external-task.ts`
- `src/project-chat-ipc-seam.ts`
- `electron/project-chat-ipc.ts`
- `electron/project-chat-ipc.test.mjs`
- `electron/electron-env.d.ts`
- `electron/project-chat-broker.ts`、`electron/project-chat-broker.test.mjs`（仅 external unread/recipient snapshot seam）
- `electron/project-chat-pairing.test.mjs`（新增）

禁止写：runner/reducer、协议字段、Runtime。

## 实施步骤

1. Main 把已验证 PairEnvelope 送至主窗口 modal；renderer 只能选择现有 projectId/accept/reject，不能修改 origin。
   Pair GET/POST 复用 M1-02 同一 Main-only deadline transport 与固定 `/pair/{request_id}` endpoint；Main 保留完整 envelope/nonce/credential，renderer 只接收 opaque pairing id、display name、规范 origin 与 expiry。typed pairing event/response 只能由登记的主窗口调用，项目窗口/Preview/subframe/错误 URL 全部拒绝。
2. 对话框显示 design 要求的来源、目标、能力/不能读取内容；close/Escape 等同 cancel。
3. Main 收到 accept 后再次验证项目与 envelope freshness，再加密保存并回执；renderer 不接触 credential。
4. Settings 新增“网站连接”：public fields、聚焦项目、撤销二次确认；不显示 secret。
5. external task 以前置窗口快照执行精确焦点规则：窗口不存在或 draft empty + no existing active run + no prompt 才选择/显示，否则不抢焦点只增持久徽标；点击徽标选择最新未读并推进 seen cursor。
   未读状态必须由 durable website thread `receivedAt` 与项目窗口 view state 的 `externalTaskSeenAt` 投影，不能只存在 React 内存；recipient snapshot/event 不暴露 bindingId 或完整 creationSource。窗口重开/应用重启必须重建相同 count/latest target，点击后保存 cursor 并广播不增加 workspace revision 的新投影。
6. 主窗口永不自动切项目/route；项目删除/路径丢失时 Project Window 禁 submit 并给指定恢复入口。
7. 完成 dialog/status/alert/menu 的 a11y selector 与焦点测试。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-pairing.test.mjs electron/agentos-external-task.test.mjs electron/project-chat-window-manager.test.mjs
npm run test:electron
```

## 停止并报告

若 Settings category ID 或 i18n 结构需要超出 allowlist 的全局迁移，先列出精确文件，不直接全仓替换。
