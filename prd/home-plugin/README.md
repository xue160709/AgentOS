# Home Plugin 数据卡片

## 模块定位

Home Plugin 数据卡片模块让项目首页成为可视化工作台：项目可以在 `.agents/home-plugins/` 中定义数据卡片，AgentOS 以受限沙箱运行并渲染 A2UI 输出。

## 当前已实现

- 扫描 `.agents/home-plugins/<slug>/manifest.json` 与 `extractor.js`，识别 data/task 卡片。
- 数据卡片 extractor 在只读 VM 沙箱中运行，禁止 `import`、`require`、`process`、`fetch`、网络和任意代码生成。
- host API 支持列文件、读文本/JSON、只读 SQLite 查询、exists 和 stat，均限制在项目内。
- 插件输出会规范化为 A2UI messages 或 small/medium/large variants。
- 首页支持卡片刷新、排序、尺寸保存、删除和打开项目文件动作。
- 项目根 `TODO.md` 符合约定时会生成内置 TODO 数据卡。
- 卡片定制会创建专用 Agent 线程并注入 Home Plugin 定制上下文。

## 用户流程

```text
1. 用户打开项目首页
   ↓
2. 系统扫描内置 TODO 卡与项目 Home Plugin
   ↓
3. 受限沙箱运行数据 extractor
   ↓
4. 首页按卡片尺寸渲染 A2UI 输出并允许刷新/排序/定制
```

## 还没做什么

- Home Plugin acceptance 已完成正式验收状态同步；只读沙箱、A2UI 输出、内置 TODO 卡和基础首页渲染已有验收证据。
- A2UI 卡片 action、真实项目自定义插件和全页面点击式 UI 截图仍可补充为后续回归证据。

## 关键决策

- 数据卡片只读运行，任务执行不混入数据卡 extractor。
- 输出 hash 用于判断卡片是否 unchanged，降低不必要 UI 更新。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `task-home-plugin`：复用 Home Plugin 目录结构，但负责长期任务。
- `workspace-session`：首页归属当前项目。
- `chat-agent-runtime`：卡片定制通过专用聊天线程完成。
