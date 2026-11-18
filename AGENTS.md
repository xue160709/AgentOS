# 运行时模型选择

当创建 Codex Thread 或委派 subagent 时，必须按下表显式设置 `model` 与 `thinking`，不得依赖平台默认值或继承父任务的模型。

准备创建 Codex Thread 前，必须完整读取 [`.codex/docs/threads.md`](.codex/docs/threads.md)，并遵守其中的能力、独立性、持续价值、Work Order、所有权与停止条件。

| 工作 | 模型 | 推理档位 |
| --- | --- | --- |
| 协调 Thread | `gpt-5.6-sol` | `medium`；跨模块裁决密集时使用 `high` |
| 大范围仓库读取、来源扫描或候选归纳 | `gpt-5.6-terra` | `medium` |
| 产品/业务方案、复杂规格或跨模块设计 | `gpt-5.6-sol` | `high` |
| 普通模块实现 | `gpt-5.6-terra` | `medium`；复杂状态机或高风险时使用 `high` |
| 独立代码审查、复杂状态机审查或安全审查 | `gpt-5.6-sol` 或 `gpt-5.6-terra` | `high`；判断密度更高时选择 Sol |
| 机械转换、格式检查或分类 | `gpt-5.6-luna` | `medium`；分类需要非平凡判断时使用 `high` |

上述表格同时适用于两种执行形式：

- 创建 Codex Thread 时，在创建请求中带上选定的值。
- 委派 subagent 时，在委派请求中带上选定的值。

用户明确指定的模型或推理档位优先。当前平台不支持所选组合时，使用最接近的受支持组合，并报告降级情况。
