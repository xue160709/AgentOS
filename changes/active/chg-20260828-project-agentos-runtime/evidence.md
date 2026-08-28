# 项目专属 `.agentos` Runtime｜Development Check 证据

日期：2026-08-28  
Change：`chg-20260828-project-agentos-runtime` revision 3  
结论：Revision 3 实现与自动化 Development Check 完成，`coverage_gate=pass`。未执行真实 Electron GUI 正式验收，`acceptance_status=not_accepted`。

## Revision 3 合同增量

- 创建按钮必须从 main-window capability 进入对应项目的独立 Chat 窗口，自动创建并选中线程、提交 Runtime 网页创建请求；主窗口不得出现空对话副作用。
- Runtime prompt 只允许独立项目 Chat 窗口的普通提交/编辑重提，以及上述 Main-owned 按钮编排；主窗口普通 Chat、Agent command、Website task、Task/Home managed run、Workspace/非项目和失效路径请求不允许注入。
- Main 根据 IPC sender capability / 专用编排判定资格，并从权威项目路径派生 runtimeRoot；renderer 不得提供 root 或 prompt-scope 标记。
- 专用按钮 IPC 仅 main-window capability 可调用。
- Runtime system prompt 与按钮的中英文创建请求明确要求读取当前项目文件夹已有内容和数据，以 Next.js、React、TypeScript 在 `.agentos/` 构建数据可视化工作台；必须在 `.agentos/` 执行 `npm install` 后执行 `npm run build`，并静态导出 `out/index.html`；禁止以 Python、Flask、Streamlit 或其它 Python 方案实现或启动 Runtime。

### Revision 3 验证状态

| 项目 | 状态 |
| --- | --- |
| 自动化定向测试 | PASS，77/77 |
| 完整 Electron 回归 | PASS，299/299，`node --test --test-concurrency=1 electron/*.test.mjs` |
| `npm run typecheck` | PASS |
| `npm run build` | PASS；renderer、Electron main/preload 构建及 macOS arm64 DMG/ZIP 打包完成（项目未配置 notarize，公证按现有配置跳过） |
| `git diff --check`（本次文档同步） | PASS |
| 冲突措辞检查 | PASS；未发现仍以“所有/有效项目聊天”作为 Runtime prompt 注入资格或把入口定向到主窗口 Chat 的现行合同措辞 |
| 真实 Electron GUI 正式验收 | 未执行；必须验证窗口、线程选择、请求提交和主窗口零副作用 |

最新 Runtime prompt 收紧后的定向回归：`node --test electron/project-runtime-prompt.test.mjs electron/project-runtime-placement.test.mjs electron/project-chat-broker.test.mjs electron/desktop-seam.test.mjs electron/chat-workspace-store.test.mjs electron/workspace-session.test.mjs electron/project-chat-contract.test.mjs electron/chat-run.test.mjs`，PASS，96/96；`npm run typecheck` 与 `git diff --check` 均 PASS。

## Revision 2 历史 Development Check（不覆盖 Revision 3）

## 合同证据

- Project Runtime 根固定为 `<project>/.agentos/`；目录缺失返回 `not_initialized`，项目根不作为 fallback。
- Runtime Definition 持久化 `project` / `workspace` owner；旧缺省 owner 迁移为 workspace，project-owned Definition 不进入 Workspace Tab。
- Main 以权威 `projectId` 与项目路径派生 Runtime system prompt；该 Revision 2 基线的“有效项目”范围已被 Revision 3 收窄。
- 项目 run 前后只读比较根目录网页工程迹象；`.agentos` 仍缺失时仅显示落点提示，不移动、复制、删除或重试。
- Project Preview、Workspace Preview、start/development 与 Runtime edit bridge 均校验 owner；既有 last-good、取消与 generation fence 继续由原链路负责。

## 验证命令

| 命令 | 结果 |
| --- | --- |
| `node --test electron/project-runtime-prompt.test.mjs electron/project-runtime-placement.test.mjs electron/project-chat-broker.test.mjs electron/desktop-seam.test.mjs electron/chat-workspace-store.test.mjs electron/workspace-session.test.mjs electron/project-chat-contract.test.mjs electron/chat-run.test.mjs` | PASS，92/92 |
| `node --test electron/local-app-runtime.test.mjs`（沙箱外；需要 loopback bind） | PASS，23/23 |
| `npm run typecheck` | PASS |
| `npm run test:electron`（沙箱外，默认文件并发） | 291 项通过、0 断言失败；`local-app-runtime.test.mjs` 因并发 fixture 子进程互扰未退出，人工中断，不计作通过 |
| `node --test --test-concurrency=1 electron/*.test.mjs`（沙箱外） | PASS，294/294，exit 0 |
| `git diff --check` | PASS |

## 未验证项

- 尚未执行真实打包 Electron Chromium GUI 的项目 Runtime 点击路径、Preview 截图与可访问性人工验收。
- 正式 Acceptance 必须按 `TESTING_CHECKLIST.md` 的 revision 2 增量矩阵补 GUI 证据；Development Check 不替代正式验收。
