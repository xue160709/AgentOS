# 验收记录

2026-11-19，revision 1。实现版本由 product.md 中的基线与工作区差异共同标识。复核方式为 `git diff --binary <verify_base> -- electron src | shasum -a 256`。

| 场景 | 结果与证据 |
|---|---|
| AC-SESSION-001 | PASS。浏览器组件测试加载真实 TaskCardDialog，切换 Skills 后断言默认独立、控件夹在 Skill 选择器与 TODO 之间。管理器测试从磁盘删除字段后重新加载，仍得到 independent。 |
| AC-SESSION-002 | PASS。旧配置和独立配置都以重复 Skill 执行两轮，逐个注入结果，断言四个不同线程、顺序、轮次、当前请求不含上一结果。 |
| AC-SESSION-003 | PASS。表单保存 shared 并重新打开回显，管理器从磁盘加载 shared 后四个请求仅创建一个线程。 |
| AC-SESSION-004 | PASS。第二步活动时，按已结束线程调用停止不会取消当前任务；按任务停止准确取消第二个请求，后续请求数保持不变。 |

`npm run typecheck` 退出 0。`node --test electron/task-home-plugin-manager.test.mjs electron/project-chat-broker.test.mjs electron/project-chat-renderer.test.mjs` 退出 0，46/46。浏览器测试使用真实组件、隔离的桌面桥接替身。后台测试替换模型端口，未调用真实模型或运行安装包。
