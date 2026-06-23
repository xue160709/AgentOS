# 本地文件上下文验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：文件访问必须限制在项目根目录内
系统 SHALL 对所有项目文件读取、预览、附件、搜索和路径存在性检查执行项目根路径校验，符号链接最终目标 MUST NOT 逃逸项目根。

#### 场景：预览项目内 Markdown 文件
- GIVEN 项目根目录下存在 `src/README.md`
- WHEN 用户请求预览该文件
- THEN 系统返回 `kind: "markdown"` 和文件文本内容供预览层渲染

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/project-content.test.mjs

#### 场景：请求预览逃逸路径
- GIVEN 用户或 UI 请求预览包含 `..` 的项目外路径
- WHEN 主进程处理预览请求
- THEN 系统拒绝读取并返回“只能预览当前项目内的文件”

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/project-content.test.mjs

### 需求：项目文件树按安全忽略规则展示
系统 SHALL 展示项目内目录和文件，并忽略 `.git`、`node_modules`、`dist`、`coverage`、`.next`、`.vite` 等大型生成目录。

#### 场景：打开文件树
- GIVEN 活动项目内同时存在源码目录和 `node_modules`
- WHEN 用户打开文件侧栏
- THEN 系统返回项目根名称和节点树，且忽略大型生成目录

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/project-content.test.mjs

#### 场景：文件变化事件
- GIVEN 用户订阅某项目文件变化
- WHEN 项目内文件发生变化
- THEN 系统防抖推送该项目的 `relativePath` 变化事件，并在取消订阅后释放 watcher

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/project-content.test.mjs

### 需求：Composer 支持项目文件模糊搜索
系统 SHALL 在聊天输入的 `@` 提及时按项目文件名和相对路径模糊搜索，限制遍历数量、深度和返回条目数。

#### 场景：用户输入文件关键词
- GIVEN 活动项目内存在匹配关键词的文件
- WHEN 用户在 Composer 中输入 `@` 后继续输入文件关键词
- THEN 系统返回最多 24 条项目文件或目录候选

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=listbox[name="文件建议"]

#### 场景：桌面 adapter 不可用
- GIVEN 当前运行环境没有 `window.desktop.searchProjectFiles`
- WHEN UI 尝试搜索项目文件
- THEN 系统返回稳定的不可用结果，而不是抛出未捕获异常

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/project-content.test.mjs

## 平台专项验证（Electron + React）

- 验证主进程路径解析不会逃逸项目根。
- 验证预览大小限制和附件数量/大小限制。
- 验证文件 watch 订阅/注销不会泄漏。

## 建议验证命令

```bash
npm run typecheck
node --test electron/project-content.test.mjs
```

