# Skill 与 Agent 编排索引

读取时机：需要派工、并行、串行降级、合并角色输出或处理共享单点文件时。本文件只回答"哪个组织判断由哪份文件决定"，正文规则全部在被指向的文件里。

## 权威入口

| 判断 | 唯一入口 |
|---|---|
| 用户责任、单层 sub-agent 关系和外部授权 | `AGENTS.md` |
| Intent、阶段、专业缺口、Light/Medium/Heavy、required 与质量触发 | `.codex/rules/lifecycle.md` |
| writer、精确路径、并行冲突、失败恢复和降级 | `.codex/rules/ownership.md` |
| sub-agent 继承历史、任务包字段与返回格式 | `context-sharing.md` |
| 角色公共准则、任务模式与权限覆盖 | `role-conduct.md` |
| 设计/产品方案的生成时质量线与判例供给 | `proposal-quality-bar.md` |
| 多候选起草的触发、隔离、比较与综合 | `competitive-drafting.md` |
| 产品产物、共享状态和正式完成边界 | `product-artifact-contracts.md` 与 `acceptance-and-verification.md` |
| 阶段之间的事实流向 | `product-development-lifecycle.md` |
| 可用角色与角色指令 | `.codex/config.toml` 与 `.codex/agents/*.toml` |
| 角色的专业方法、交付模板与自检 | `knowledge/roles/<role>.md` |
| 模型与推理档位 | 各角色 TOML 的显式声明；`.codex/config.toml` 提供默认值 |

完成标准：每项组织判断都能追溯到上表的唯一入口，没有在本文件之外形成第二个版本。
