---
change_id: chg-20260828-project-agentos-runtime
revision: 3
status: accepted
---

# 项目专属 `.agentos` Runtime｜方案设计

## Revision 3 冻结纠正（Current / as-built）

「让 Agent 创建 Runtime 网页」是 Main-owned 项目主页动作，不是主窗口 Chat 的快捷提交：Main 先按项目打开或聚焦唯一独立 Chat 窗口，再在该窗口自动创建并选中线程、提交创建请求。主窗口不得因此创建或选中空对话。

`.agentos` prompt 的资格由 Main 的两条权威来源导出：独立项目 Chat 窗口的 sender capability（仅普通提交/编辑重提）或上述专用按钮编排。所有其它来源——主窗口普通 Chat、Agent command、Website task、Task/Home managed run、Workspace/非项目请求——一律不合格。renderer payload 不含 `runtimeRoot`、prompt scope 或等价资格字段；Main 从权威项目路径派生实际根目录。专用按钮 IPC 仅允许 main-window capability 调用。

## 1. 产品模型

系统存在两个互不替代的 Runtime 域：

| 域 | 工程目录 | UI Host | 是否进入 Workspace Tab | Prompt 约束 |
| --- | --- | --- | --- | --- |
| Project Runtime | `<project>/.agentos/` | `project-home` | 否 | 仅独立项目 Chat 的普通/编辑重提，或 Main-owned 创建按钮编排 |
| Workspace Runtime | 用户显式绑定目录 | `workspace-tab` | 是 | 不注入 `.agentos` 约束 |

项目 Runtime 是项目的派生能力，不是一个可自由移动到工作区的 Tab。Workspace Runtime 是用户显式创建的独立工作区对象，不自动继承项目 `.agentos/`。

这是**产品对象归属**问题，不是信任边界问题：两个域运行的都是同一套受控 supervisor 产出的本地可信产物，跨 owner 引用的后果是生命周期与 consumer 归属混乱，不是权限提升。方案据此定权重——归属用一处持久字段加一处判定表达，安全不变量沿用 `chg-20260825` 已实现的部分。

## 2. 目录合同

项目 Runtime 根目录固定为：

```text
<project>/.agentos/
├── package.json
├── src/
├── public/
└── out/            # 示例；实际静态输出仍由 package.json.agentos 声明
```

新增常量与解析函数（放在 `electron/local-app-runtime/index.ts` 或紧邻的既有模块中，不单建模块）：

```ts
export const PROJECT_AGENTOS_RUNTIME_DIRECTORY = '.agentos'

/** 项目 Runtime 根目录（lexical） */
export function projectRuntimeRoot(projectPath: string): string {
  return path.join(path.resolve(projectPath), PROJECT_AGENTOS_RUNTIME_DIRECTORY)
}

/** canonicalRoot 是否确实落在项目根目录内（拒绝 symlink 逃逸） */
export function isContainedInProject(projectRealRoot: string, canonicalRoot: string): boolean {
  return canonicalRoot === projectRealRoot || canonicalRoot.startsWith(projectRealRoot + path.sep)
}
```

**不引入** lexical containment 校验：`.agentos` 由主进程用常量拼接得到，不接受 renderer 或用户输入，lexical 包含关系恒真，单独校验只增加代码路径不增加安全性。

**不引入** 独立的 `isProjectRuntimeRoot` / `isProjectRuntimeDefinition` 谓词模块：前者退化为 `canonicalRoot === realpath(projectRuntimeRoot(p))` 加一次 `isContainedInProject`；后者退化为 `definition.owner.kind === 'project' && definition.owner.projectId === project.id`，都在调用点直接表达即可。

`inspectLocalAppDirectory()` 已对传入路径执行 `realpath` 并返回 `canonicalRoot`（`electron/local-app-runtime/index.ts`），项目 Runtime 复用它，逃逸判定只在其返回后做一次。

所有项目 Runtime 的发现、注册、构建、Preview 和 fingerprint 都必须经由 `projectRuntimeRoot()` 得到根目录，不得各自拼接 `'.agentos'` 字面量。

## 3. Runtime 归属

为 Runtime Definition 增加持久归属：

```ts
type RuntimeOwner =
  | { kind: 'project'; projectId: string }
  | { kind: 'workspace' }
```

约束：

- project-owned Definition 只能绑定一个现存项目，根目录必须是该项目的 `.agentos/`。
- workspace-owned Definition 继续使用用户显式绑定目录。
- `workspaceTabs` 只能引用 workspace-owned Definition。
- `project-home` Preview host 只能引用与 `projectId` 一致的 project-owned Definition。
- `workspace-tab` Preview host 只能引用该 Tab 绑定的 workspace-owned Definition。
- Runtime manager/supervisor 可继续按 Definition ID 复用底层实现，但不能跨 owner 复用 consumer 或 Preview host。

持久字段而非路径反推是必要的：用户可以手动把 Workspace Runtime 绑定到 `<project>/.agentos`，路径反推在该情形下有歧义。

旧 Definition 没有 owner 时默认按 `workspace` 迁移，不能根据路径猜成 project-owned。

## 4. 项目 Runtime 生命周期

### 4.1 发现

```text
打开项目 Runtime 页面
  -> 读取权威 project.path
  -> 计算 projectRuntimeRoot(project.path)
  -> 路径不存在：not_initialized，不 spawn
  -> inspect .agentos/package.json（内部已 realpath）
  -> 校验 canonicalRoot 未逃逸项目根目录
  -> 校验 package.json.agentos 或受控 dev script
  -> 检查 project-owned Definition 与信任
  -> 注册/恢复 Runtime
```

项目根目录的 `package.json`、`node_modules`、dev script 和静态声明不参与项目 Runtime 发现。

### 4.2 未初始化

`ProjectRuntimeResult.status` 增加：

```ts
'not_initialized' | 'trust_required' | 'ready'
```

`not_initialized` 时：

- 不创建空工程，不猜框架，不运行 npm。
- 项目页面显示目标路径 `.agentos/` 和“尚未创建项目 Runtime”。
- **提供「让 Agent 创建 Runtime 网页」入口**：点击后 Main 打开或聚焦对应项目的独立 Chat 窗口，在其中自动创建并选中线程并提交一次带 Runtime 约束的普通 run；主窗口不得创建或选中空对话。`not_initialized` 不是终点状态，用户不应被迫自己去猜要在聊天里说什么。该入口只编排会话，不由主进程写任何文件。
- Agent 完成写入或项目文件 watcher 发现 `.agentos/package.json` 后重新 ensure。
- 目录首次出现后仍遵守现有显式信任流程，未信任前不执行脚本。

### 4.3 构建与预览

- build/dev `cwd` 固定为 canonical `.agentos/`。
- 静态声明仍从 `.agentos/package.json.agentos` 严格解析。
- `outputRoot` 必须位于 canonical `.agentos/` 内。
- 验证后的输出仍提交到 Main-owned immutable last-good artifact。
- Preview 继续加载 opaque-token artifact；不直接裸加载可变工作目录。
- 构建失败保留旧 last-good，不把 Runtime 失败改写成 Agent 任务失败。

## 5. UI 与 Host 归属

项目 Runtime 页面：

- 保留项目内嵌 Preview、状态、刷新、构建/更新和停止等项目内操作。
- 移除“打开页签”按钮及其 `onOpenTab` controller action（`ProjectHomeRuntimeView.tsx` / `AppShell.tsx` 的 `openProjectRuntimeTab`）。
- 不创建 `workspaceTabs` 记录。
- Preview host 固定为 `{ kind: 'project-home', projectId, mountId, runtimeDefinitionId }`。

Workspace Runtime 页面：

- 继续通过用户显式绑定目录创建 workspace-owned Definition 和 Tab。
- 不显示项目 `.agentos/` 的自动入口。

Main 侧的 owner 判定：

- `openWorkspaceTab` 拒绝 project-owned Definition。
- Preview 创建的 host 匹配判断中增加 owner 维度。

`electron/main.ts` 中 Preview 创建前后的双段校验（host registration、binding、runtimeId、generation fence）在 `chg-20260825` 中已经实现并生效。本变更**在已有条件中增加 owner 判定**，不新建校验层，也不为「renderer 伪造 Definition ID」「消费旧快照」单独建模：这些路径的既有 fence 已经覆盖，且跨 owner 引用不构成权限提升。

## 6. Agent System Prompt 与写入落点

### 6.1 项目上下文

Main 已掌握权威项目记录。它只在独立项目 Chat 窗口的普通提交/编辑重提，或 main-window capability 调用的创建按钮编排中判定 prompt eligibility；再由主进程按权威项目路径派生 `runtimeRoot`：

```ts
type ProjectAgentRuntimeContext = {
  projectId: string
  projectRoot: string
  runtimeRoot: string
}
```

`runtimeRoot` 一律由 Main 用 `projectRuntimeRoot()` 计算。renderer 不得提供或覆盖 `runtimeRoot`、prompt scope 或等价资格标记；Main 依据 sender capability / 专用编排自行判定资格。主窗口普通 Chat、Agent command、Website task、Task/Home managed run、Workspace/非项目请求和路径已失效项目一律不注入。

### 6.2 Prompt 内容

新增 `electron/project-runtime-prompt.ts`，生成以下语义的追加 system prompt，由 `buildRequestAppendSystemPrompt()` 拼入：

```text
<agentos_project_runtime>
当前项目的 AgentOS Runtime 网页工程根目录是：
<absolute-project-path>/.agentos

当任务需要创建或修改项目 Runtime 时：
- 先读取当前项目文件夹已有的文档、数据、代码和内容；
- 基于这些真实内容构建数据可视化工作台；
- 必须使用 Next.js、React、TypeScript，并配置静态导出产出 out/index.html；
- 不得使用 Python、Flask、Streamlit 等 Python 方案替代 Runtime；
- 所有 Runtime 文件必须位于上述 .agentos 目录内；必须在该目录执行 npm install，再执行 npm run build，并以成功生成 out/index.html 作为完成条件。

不要把 Runtime 网页实现写入项目根目录或 Workspace Runtime 目录。
可以只读访问项目其他文件作为数据和上下文，不因创建 Runtime 改写源文件。
用户明确要求修改非 Runtime 项目代码时，按用户指定目标执行。
</agentos_project_runtime>
```

创建按钮的中英文用户提示重复上述 Next.js、项目内容、数据可视化工作台、静态导出与禁用 Python Runtime 的关键约束；即使任一层提示被单独检查，目标也保持明确。

该提示稳定附加到**合格的独立项目 Chat 普通/编辑重提或 Main-owned 创建按钮编排请求**，不依赖易漏判的“是否为代码任务”分类；其中的条件式措辞保证只约束 Runtime 网页实现。有效项目本身不是注入资格。

Agent `cwd` 仍为项目根目录，以继续读取项目指令、业务文件和知识上下文。

### 6.3 落点反馈（本方案唯一无法机器强制的目标）

Prompt 是**建议性**的，且其条件措辞（是否 Runtime 网页 / 是否用户显式指定其他目标）恰是模型最易判错的形式。方案不假设它总是生效，必须让失败可见：

- 一次项目 run 结束后，若 `.agentos/` 仍不存在，检查项目根目录是否新出现疑似网页工程迹象（新增 `package.json`，或新增 `index.html` / `src` 且此前不存在）。
- 命中时，项目 Runtime 页面在 `not_initialized` 之外附加提示：Runtime 网页似乎被写到了项目根目录而非 `.agentos/`，并显示目标路径。
- 该检查**只读、只提示**：不移动、不复制、不删除任何文件，也不自动重试 Agent。
- 未命中时保持原有 `not_initialized` 文案。

这是本变更中唯一靠概率生效的环节，因此它得到显式的检测与反馈，而不是只有一段 prompt 措辞。

## 7. 编辑收口

- Runtime edit coordinator 仍按 `projectId` 聚合可靠写入事实。
- Runtime bridge 只解析该项目的 project-owned `.agentos/` Definition。
- source fingerprint 只扫描 `.agentos/` 工程，并继续忽略声明 output、`node_modules`、`.next` 等生成目录。当前 fingerprint 覆盖整个项目根，项目任意文件变动都会让静态预览变 stale；收窄到 `.agentos/` 同时修复该问题。
- `.agentos/` 尚未初始化时记录 Agent run，但不启动 Runtime；创建完成后重新 ensure，后续显式信任/构建接管。
- 项目其他目录变化不应使 `.agentos/` 静态预览变 stale，也不触发其 build。

## 8. 迁移

- 不自动移动、复制或删除文件。
- 旧 Definition 缺少 owner 时迁移为 workspace-owned。
- 旧“根目录等于项目路径”的 Definition 不再被项目首页选中；若仍被 Workspace Tab 引用则继续保留。
- `.agentos/` 存在时创建或复用 project-owned Definition；每个项目最多一个。
- `.agentos/` 不存在时项目停在 `not_initialized`，不回退到项目根目录 Runtime。这是净回归，由 §4.2 的创建入口补偿（见 proposal「已知取舍」）。
- 删除项目时释放对应 project-owned Runtime、Preview 和信任关联；是否保留磁盘 `.agentos/` 仍由用户决定，应用不得删除项目文件。

## 9. 安全不变量

沿用 `chg-20260825` 已实现的不变量，本变更不放宽：

- Renderer 不能提供项目 Runtime 的 cwd、executable、args、outputRoot、file URL 或 ready URL。
- 目录未信任时不得 spawn build/dev。
- Preview 创建前后的 generation fence 与 host registration 校验保持不变。

本变更新增：

- `.agentos/` 的 canonicalRoot 必须位于项目根目录 realpath 之内，symlink 逃逸拒绝且不 spawn。
- Preview host kind 与 Runtime owner 必须匹配。
- 日志和 UI 只显示必要的项目相对路径，不扩大敏感路径暴露。

## 10. 验收矩阵

| 场景 | 预期 |
| --- | --- |
| 项目根有 package.json，`.agentos/` 不存在 | `not_initialized`，不 spawn，显示创建入口 |
| `.agentos/package.json` 有合法静态声明 | 以 `.agentos` 为 cwd 构建并显示 Preview |
| `.agentos` 是逃逸项目的 symlink | 拒绝，不 spawn |
| 项目 Runtime 请求打开 Workspace Tab | UI 无入口，`openWorkspaceTab` 也拒绝 project-owned |
| Workspace Tab 使用手动目录 | 行为保持，完全不读取 `.agentos` |
| 项目 Agent 创建 Runtime 页面 | 文件位于 `.agentos/`，重新探测后可预览 |
| 项目 Agent 把 Runtime 页面写到项目根 | 页面提示落点错误并显示目标路径，不自动搬运文件 |
| 项目 Agent 修改非 Runtime 文件 | 不被强制改写到 `.agentos/`，不触发 Runtime build，不误报落点提示 |
| 点击创建入口 | 仅 main-window capability 可发起；打开对应独立 Chat 窗口，在其中创建/选中线程并提交；主窗口不产生空对话 |
| 主窗口普通 Chat 或受管外部任务 | 即便关联有效项目，也不注入 `.agentos` prompt |
| build 失败 | 保留 last-good，Agent 结果独立 |
