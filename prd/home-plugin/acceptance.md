# Home Plugin 数据卡片验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：项目首页扫描 Home Plugin 数据卡片
系统 SHALL 扫描项目 `.agents/home-plugins/<slug>` 目录，读取并标准化 `manifest.json`，按 `kind` 区分数据卡片和任务卡片。

#### 场景：加载数据卡片
- GIVEN 项目存在合法 data Home Plugin
- WHEN 项目首页打开或刷新
- THEN 系统读取 manifest 并准备运行该插件的 `extractor.js`

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=region[name="项目首页"]｜验证方式: node test-results/full-acceptance-smoke.mjs｜证据: TESTING_CHECKLIST.md｜

#### 场景：插件目录不存在
- GIVEN 项目没有 `.agents/home-plugins` 目录
- WHEN 项目首页请求运行 Home Plugin
- THEN 系统返回空态或仅返回内置 TODO 卡，不报错

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

### 需求：数据插件在受限只读沙箱中运行
系统 SHALL 在限制 import、require、process、网络、进程访问和资源用量的环境中执行 `extractor.js`，并只提供项目内只读 host API。

#### 场景：extractor 包含禁用能力
- GIVEN `extractor.js` 源码包含 `require`、`fetch` 或其它禁用访问
- WHEN 系统运行该插件
- THEN 系统拒绝运行并返回诊断信息

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

#### 场景：读取超过资源上限
- GIVEN extractor 通过 host API 读取过大的文件或超过总读取上限
- WHEN 插件运行
- THEN 系统返回卡片 diagnostics，并不阻塞其它卡片渲染

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

### 需求：插件输出标准化为 A2UI 可渲染内容
系统 SHALL 将 extractor 输出标准化为 A2UI messages、variants 或组件树，并在缺少 surface 信息时补充项目首页 surface。

#### 场景：插件返回多尺寸 variants
- GIVEN extractor 返回 small、medium、large variants
- WHEN 首页按当前卡片尺寸渲染
- THEN 系统选择对应尺寸输出，缺失时按 medium/large/small 顺序回退

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=article[name="Home Plugin 卡片"]｜验证方式: node test-results/full-acceptance-smoke.mjs｜证据: TESTING_CHECKLIST.md｜

#### 场景：用户刷新卡片
- GIVEN 首页显示至少一张可运行卡片
- WHEN 用户点击刷新操作
- THEN 系统重新运行对应插件并更新 output hash 与展示内容

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=button[name="刷新卡片"]｜验证方式: node test-results/full-acceptance-smoke.mjs｜证据: TESTING_CHECKLIST.md｜

## 平台专项验证（Electron + React）

- 验证 extractor 不具备网络、进程或项目外文件访问能力。
- 验证卡片 action 打开文件前仍执行路径过滤。
- 验证内置 TODO 卡只在 TODO.md 符合约定时出现。

## 建议验证命令

```bash
npm run typecheck
npm run test:home-plugin
```

