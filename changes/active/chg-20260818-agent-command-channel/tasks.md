# Tasks

- [x] `ACC-01` owner: main_agent｜依赖：无｜写入：`proposal.md`、`prd/chat-agent-runtime/acceptance.md`、`TODO.md`｜固化范围、非目标和 ATDD 契约。
- [x] `IMP-01` owner: main_agent（串行 implementation_engineer 职责）｜依赖：`ACC-01`｜写入：`src/agent-command-channel.ts`、`src/components/**`｜实现通道、非激活线程创建与 Chat Run 状态桥接。
- [x] `TST-01` owner: main_agent（串行 quality check 职责）｜依赖：`IMP-01`｜写入：`electron/agent-command-channel.test.mjs`、`electron/workspace-session.test.mjs`｜覆盖核心状态与 Workspace Session 边界。
- [x] `SYNC-01` owner: main_agent｜依赖：`IMP-01`｜写入：`/Volumes/macOS/Github/IntelligentOS-APP` 对应范围｜同步相同通道代码并接入选题入口。
- [x] `CHK-01` owner: main_agent｜依赖：`TST-01`、`SYNC-01`｜写入：`evidence.md`、`TODO.md`｜运行双仓库 Codex 自检并记录剩余风险。
- [ ] `VER-01` owner: project-verify｜依赖：`CHK-01`｜写入：`prd/chat-agent-runtime/acceptance.md`、验收证据、`TODO.md`｜独立执行正式验收并决定是否关闭 Change。
