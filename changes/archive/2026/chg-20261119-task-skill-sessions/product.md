---
change_id: chg-20261119-task-skill-sessions
revision: 1
change_type: product
status: verified
verify_debt: none
verify_base: b0ec9291d4f5b34b5c7de4996b6d8020cb447d8d
verify_diff_sha256: 3e4a3384eaf1ddd23fd4a21ac358d0be94718437310197586b1782a8fe2d814a
confirmation_source: explicit_user_statement
aligned_at: 2026-11-19
verify_policy: blocking
---

# 任务卡 Skill 独立会话

## 目标

任务卡 Skills 编排支持每个 Skill 步骤在新会话中完成，避免共用前一步的对话上下文。用户提出将此作为可设置的执行方式；会话方式随任务卡保存。

## 变更前

任务卡每次启动创建一条任务线程，按步骤顺序向该线程提交请求，多次运行也共用线程。参见 [任务卡 PRD](../../../../prd/task-home-plugin/README.md)。

## 已确认

- 独立会话不传递前一步摘要；默认使用独立会话。
- Q-002：本期暂缓任务卡上的「查看步骤」入口与展开列表。
- Q-004：失败恢复暂缓。
- 正式验收通过后归档。

- Q-003：原配置缺少会话方式的旧卡也默认独立。设置位置为 Skill 选择区下方、TODO 模式上方。

## 完成定义

用户能够为 Skills 任务选择独立会话，并按配置顺序执行；在独立模式下，每轮的每个步骤使用新会话，步骤之间不传对话或摘要。正式验收通过后归档。
