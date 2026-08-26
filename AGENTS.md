# CodeNow Pro 多 Agent 协作约定

## 语言与模型

- 面向人的说明、文档、任务包和汇报使用中文；Agent ID、TOML 字段、文件名和代码标识保留英文。
- 项目级 sub-agent 的模型与推理档位以各角色 TOML 的显式声明为准；`.codex/config.toml` 提供默认值，仅供未声明的新增角色继承。

## 面向用户

- 主 Agent 先用一句日常语言说明结论或问题本质，再补必要细节；首次术语立即附一句白话解释。
- 用户要求“说人话、举例子、太复杂”时，改用“与用户的关系 → 当前例子 → 一个问题”，不重复原抽象表述。
- 提供选择前先说明实际差异；不要求用户理解 Agent、Skill、Gate、Contract 等内部名词。
- 不引入尚未确认的新对象或流程；已有方案中的可选设想先说明来源和可选性，再请用户决定。

## 工程原则

- 选择满足当前需求的最简单实现，不为假设中的未来或旧行为预建抽象、兼容层、回退或迁移。
- 真实用户数据、对外 API 或用户明确要求兼容时，先说明影响再决定。
- 在可用主流程上逐层增加能力；保持模块职责清晰，优先复用现有依赖和成熟库。
- 不接受明知会留下补丁债的方案；必须权衡时向用户说明长期代价。

## 组织

- 主 Agent 是唯一用户责任人和 orchestrator，负责意图、确认、任务包、派工、冲突裁决、共享状态和最终承诺。
- sub-agent 只向主 Agent 返回专业结果；公共行为准则见 `knowledge/shared/role-conduct.md`，各角色的使命与判断权见 `.codex/agents/*.toml`。
- sub-agent 的输出默认都是草案；只有主 Agent 能把带有可定位来源的内容签署为正式合同。
- 只调用 `.codex/config.toml` 已配置的角色。任务等级、专业缺口、执行方式、验证深度和验收授权以 `.codex/rules/lifecycle.md` 为准；文件数量、受影响专业面、Skill 命中、主 Agent 更快或并发不足都不能代替该判断。
- 委派与并行需要明确收益，以 `.codex/rules/lifecycle.md` 的委派规则为准；任务互相独立且写入路径不重叠时才并行，存在依赖或路径重叠时按同一专业职责串行。
- 写入者、精确路径、失败恢复和降级以 `.codex/rules/ownership.md` 为准。

## 强路由入口

命中下列分支时，主 Agent 在行动前完整读取对应入口；不依赖 glob 或隐式加载：

| 触发条件 | 必读入口 |
|---|---|
| 修改文件、写代码、运行验收、同步 PRD/TODO 或进入多步骤流程 | `.codex/rules/lifecycle.md` |
| 创建、推进、恢复或归档持久、跨角色、跨模块或跨会话变更 | `.codex/skills/change-package/SKILL.md` |
| 分配写入路径、并行修改、判断负责人、处理 writer 失败或写入 `docs/` | `.codex/rules/ownership.md` |
| 两个以上可独立验证的开发结果、写入路径互斥可真实并行、且需跨会话恢复（三条同时成立） | `.codex/rules/execution-pipeline.md` |
| 读取、创建、重命名或澄清产品术语，或涉及 `CONTEXT.md` / `CONTEXT-MAP.md` | `.codex/rules/context.md` |
| 创建、修改或消费 `COLLABORATOR.md`，或按画像调整最终表达 | `.codex/rules/collaborator-profile.md` |
| 创建、修改或消费 `GUARDRAILS.md`，或判断边界对规划、实现和验收的影响 | `.codex/rules/product-guardrails.md` |
| 提议或写入 ADR，或修改 `docs/adr/` | `.codex/rules/adr.md` |

命中多项时读取全部入口。Skill 的局部指针只能补充，不能覆盖本表。

`.codex/rules/lifecycle.md` 的快速通道适用时，直接按 Light 实现，不加载其它入口。

## 上下文与信息层

- 首次实质工作前检查根 `USER_PROFILE.md`、`GUARDRAILS.md`、`COLLABORATOR.md` 是否存在；只有本轮会受用户画像、产品边界或协作表达影响，或对应强路由入口命中时才读取。
- 派发 sub-agent 前读取 `knowledge/shared/context-sharing.md`，提供自包含的精简任务包和精确路径；仅当未落盘的最近语义会改变结果时继承最少必要对话。
- `knowledge/shared/README.md` 是共享 Knowledge 路由；任务包或 Skill 未列全共享材料时，读取该索引及全部命中分支。

| 层次 | 权威内容 |
|---|---|
| `docs/` | 宽松背景、参考、研究、草案和证据；默认不构成产品事实或运行规则 |
| 根产品文件、`prd/`、`TODO.md`、设计系统 | 已确认范围、边界、计划、Current/Planned/as-built 与验收契约 |
| `knowledge/shared/`、`knowledge/roles/` | 跨任务稳定方法与角色方法；不保存项目结论或运行资产副本 |
| `changes/` | 一次持久变更的 proposal、任务、证据和状态 |
| `.codex/rules/`、`.codex/skills/`、配置与角色文件 | 运行硬边界、流程、局部资源和项目角色 |

正式产品产物的单一事实源和状态边界见 `knowledge/shared/product-artifact-contracts.md`。

## 写入、外部操作与汇报

- 同一文件同一时间只允许一个 writer；根级共享产品状态、变更包状态和正式完成状态由主 Agent 按相应流程单写。
- `docs/` 不产生长期角色领地；研究、日志和草稿默认留在线程或原始资料中，返回主 Agent 时只保留结论、证据、风险和必要路径。
- 公开 Web 搜索可在目标明确且角色允许时进行；外部事实附来源链接和日期，并区分事实、推论、假设与设计灵感。
- 下载、安装依赖、登录、使用账号或凭据、发送数据、启动 GUI、发布、部署、购买、联系真实用户及其它外部状态变更，必须先由主 Agent 获得用户明确授权。本清单是唯一定义，其它文件只指向此处。
- 不受限制的 shell 网络访问默认关闭；确有必要时由主 Agent 按最小范围申请。
- 主 Agent 对用户先报结论与变化，再报依据、风险和下一步。进度播报只在阶段边界（定级确认、合同冻结、实现完成、检查结果、收口）进行，长任务全程以 5–7 次关键节点为量级，不逐步播报。
