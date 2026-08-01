# Feedback

- Participant ID: project-fact
- Evidence level: E2 PROJECT_FACT
- Created at: 2026-07-30T23:30:29+08:00

## Content

项目事实（E2）：

- 产品当前把 omni-ui 多模态融合与语音控制主窗口列为 P0 主线。
- 当前入口是 Option+Space 或托盘打开独立语音命令窗；用户选择自动、命令或聊天模式，手动开始、停止、编辑 final 文本并提交。
- 自动模式将 AgentOS 内部命令直接执行；系统级长尾任务转交当前 Chat 的 Claude Agent SDK；普通问答进入当前 Chat。
- 当前配置约 21 个可直接执行的领域 action；177 个原生控件和 52 个自定义交互控件的静态审计只证明语义标注，不代表均可直接语音执行。
- voice-command BDD 的 50 条样例中，18 条路由为直接命令、30 条转交 agent_task、2 条作为 answer；该审计证明路由分类，不证明真实任务全部完成。
- 真实 macOS 麦克风/语音权限、全局快捷键、speech helper、live Provider 与外部应用副作用仍有人工验收项。
- 前序用户视角检查已模拟复现：权限/Helper 错误可能被 idle 覆盖；主窗口未回传时命令窗可长期停在执行中；执行期间快捷键可重复提交；固定 480×372 窗口下较多澄清候选会被裁切。
- 静态代码检查发现：隐藏命令窗不会结束录音；关闭录音中的旧窗口未显式 cancel，迟到事件存在跨窗口回落风险。真实时序尚未实机验证。
- 仓库当前缺少 USER_PROFILE.md 与 GUARDRAILS.md，因此不能把任何人口学特征、辅助能力或长期产品承诺当成已确认事实。
