# R3-CHECK｜Revision 3 Development Check（非正式验收）

> 状态：待 R3-01–R3-07 全部完成。默认只读；用户未明确授权正式 Acceptance，本单不得把 PRD 标记为通过。

## 任务目标与原因

独立检查 Revision 3 是否忠实实现 `C-RDS-301–309`、是否破坏 Revision 2 普通 Chat/网站/Runtime last-good，以及真实 Electron 用户路径是否与自动化证据一致。发现问题只报告并建议精确 fix work order，不直接改业务代码。

## 当前 change_id@revision

- `chg-20260818-agent-command-channel@3`
- `write_mode=response_only`；不填写 writer ownership 字段，不修改文件。
- 必读：Change 的 proposal/design/technical/acceptance/tasks/evidence、本目录 R3 工单、两个正式 PRD Revision 3 章节、R3 实际 diff 与报告。

## Read scope

- R3-01–R3-07 allowlist 内的实际代码与测试。
- Revision 2 普通 Project Chat、Website/Ticket、RuntimeEditCoordinator 回归路径。
- 运行所需的本地测试 fixture；不得访问生产网站、真实 credential 或修改真实用户数据。

## 检查顺序

1. Trace：`ATDD-RDS-301–309`、`C-021–027`、`ATDD-RUNTIME-DEV-301–306` 映射到实现与证据。
2. Identity/data：Project/Workspace scope、普通/Runtime Thread 分区、migration/rollback、Definition 删除保留。
3. Single core/security：单 writer/Runner/reducer、capability、scope spoof/subframe/Preview/root containment、脱敏。
4. State race：多轮、close/background Run/prompt、double exit、reenter during save、late build、app quit。
5. Runtime resource：Definition 隔离、root conflict、dev→build、development-only consumer、remove/relocate/trust cleanup。
6. UI/a11y：固定文案、snapshot 单一来源、焦点、disabled/alert/busy、普通列表过滤与全局搜索。
7. Regression：普通 Project Chat、网站线、普通非 Runtime auto-settle、last-good 与 Preview sandbox。

## 必须执行

```bash
npm run typecheck
npm run test:electron
npm run build
git diff --check
```

真实 Electron smoke 至少覆盖：

- Project/Workspace 同路径，项目首页不跳 Tab，第二实时实例被阻止且显式切换聚焦正确对象。
- 两入口“用 AI 修改”；两轮成功修改期间不 build；close/主窗口结束并发只收口一次。
- running/waiting 时关窗，主窗口显示恢复状态；重开 prompt/focus 只转移一次。
- build failure/reenter/旧结果；app quit/restart 后 Transcript/draft/last-good/stale。
- development-only 关闭 Chat 后仍查看；最后 consumer 停止后租约释放。

## 结论与交付

- `PASS`：无 P0/P1，自动化和 Electron smoke 完整。
- `PASS_WITH_RISK`：仅明确的非阻断平台/环境缺口。
- `FAIL`：identity、单 writer、安全、late-event、last-good、synthetic Project 或用户路径任一不满足。

返回 `status`、revision/commit/diff baseline、逐 ATDD 证据、命令/退出码、真实 smoke、风险和建议 fix 单。Development Check 不等于正式 Acceptance。

## 停止条件

发现工作区仍有活跃 writer、diff baseline 不可区分、测试会修改真实用户数据、需要真实 credential/生产外部操作，或规格之间冲突时停止，不制造 PASS。
