---
change_id: chg-20260828-project-agentos-runtime
revision: 3
decision: accepted
delivery: implemented
owner: main_agent
coverage_gate: pass
acceptance_status: not_accepted
confirmation_source: explicit_user_statement
confirmed_scope: "2026-08-28 revision 3：Runtime 创建按钮必须转入对应项目的独立 Chat 窗口并提交请求；`.agentos` prompt 仅限该独立窗口的普通/编辑重提及按钮编排，资格和根目录均由 Main 权威派生。"
---

# 项目专属 `.agentos` Runtime

## Revision 3 冻结纠正（Current / as-built）

本节覆盖 Revision 2 中“所有有效项目聊天稳定注入”及“在当前项目聊天发起”的宽泛表述：

- 点击项目主页的「让 Agent 创建 Runtime 网页」时，Main 必须打开或聚焦**该项目唯一的独立 Chat 窗口**，自动创建并选中线程，并在该窗口提交创建 Runtime 网页请求；主窗口不得创建或选中空对话。
- `.agentos` Runtime system prompt 只可注入两类请求：独立项目 Chat 窗口发起的普通提交或编辑重提，以及上述 Main-owned 创建按钮编排的提交。主窗口普通 Chat、Agent command、Website task、Task/Home managed run、Workspace/非项目请求均不得注入。
- prompt eligibility 必须由 Main 根据 IPC sender capability 或专用按钮编排派生；renderer 不得提交 `runtimeRoot`、prompt-scope 或等价资格标记。实际 `runtimeRoot` 仍只由 Main 从权威项目路径计算。
- 创建按钮专用 IPC 只接受 main-window capability；其它 renderer、独立 Chat 窗口、Preview、subframe 或任意未授权 sender 必须被拒绝。

Revision 3 已实现并通过独立自动化 Development Check；真实 Electron GUI 正式验收尚未执行，不能将自动化结果写成正式 Acceptance 通过。

## Revision 2 调整说明

Revision 1 的产品边界不变，用户已确认的范围不变。本次修订只调整**方案权重**：

- 把「四层硬隔离 + 伪造/旧快照/跨 owner 冒充测试矩阵」降级为「在已有 host 校验链路上增加一个 owner 判定」。理由：两个 Host 运行的是同一份本地可信构建产物，跨 owner 引用不构成权限提升；真正的安全不变量（renderer 不能提供 cwd / executable / args / outputRoot）在 `chg-20260825` 中已经实现并生效。
- 把独立的路径 containment 模块收敛为两个函数。理由：`.agentos` 是主进程用常量拼出的固定子目录，不是用户输入，lexical containment 恒真；唯一有价值的校验是 realpath 逃逸，而 `inspectLocalAppDirectory` 已经返回 `canonicalRoot`。
- 移除项目 Runtime 上下文的「防伪造信任边界」叙述。理由：注入的 prompt 只包含一个 Agent 本来就能 `ls` 到的绝对路径，不授予任何能力。
- **补上 Revision 1 缺失的两项**：Agent 写入落点的可见反馈，以及 `not_initialized` 空状态的创建入口。Revision 1 在机器已能强制执行的地方投入最多，在唯一靠概率生效的地方（Agent 是否真的写进 `.agentos/`）只有一段措辞且没有任何反馈，属于优先级倒置。

任务量从 32 条降到 22 条，减少的部分全部来自上述降级，新增的部分全部来自上述补齐。

## 原因

当前项目首页 Runtime 与通用 Workspace Runtime 共用 `RuntimeDefinition`、目录绑定和 Preview 能力，并默认把项目根目录本身作为 Runtime 工程根目录。这会把用户项目代码、网页预览代码和通用工作区 Runtime 混在一起，也允许项目 Runtime 被打开为 Workspace Tab。

本变更将项目内置 Runtime 收口为项目专属能力：网页工程固定位于 `<project>/.agentos/`，只在项目页面展示和运行，不创建、不绑定也不复用 Workspace Tab。项目聊天中的 Agent 在创建或修改该 Runtime 网页时，必须收到明确的 system prompt 路径约束。

## 用户已确认的边界

- 项目 Runtime 工程根目录是 `<项目根目录>/.agentos/`，不是 `.agentos/runtime/`。
- `.agentos/` 本身是可运行的网页工程根目录，可包含 `package.json`、源码、资源、构建配置和构建输出。
- 该 Runtime 只属于项目页面；项目 Runtime 不提供“打开到 Workspace Tab”，也不能被 `workspaceTabs` 引用。
- 通用 Workspace Runtime Tab 若继续保留，仍使用用户显式绑定的目录；它不发现、不创建、不加载 `.agentos/`，也不接收项目 Runtime system prompt。
- 独立项目 Chat 窗口的合格普通/编辑重提，以及 Main-owned 创建按钮编排，继续以项目根作为 Agent 工作上下文；只有 Runtime 网页相关实现被约束到 `.agentos/`。用户明确要求修改非 Runtime 项目代码时，仍按用户指定目标执行。

## 目标

1. 为每个项目提供唯一、可推导的 `.agentos/` Runtime 根目录。
2. 在产品对象和 Preview host 归属上把项目 Runtime 与 Workspace Runtime 分开，`workspaceTabs` 不能引用 project-owned Definition。
3. 仅在专用独立项目 Chat 入口或 Main-owned 创建编排中让 Agent 把 Runtime 网页代码、配置、资源和依赖写入 `.agentos/`，**并在没有写进去时给出可见反馈**。
4. 继续复用受控 build/dev supervisor、静态输出验证和 last-good 回退，但不复用 Workspace Tab 产品入口。
5. 对目录缺失、旧绑定和符号链接逃逸提供明确且安全的处理。

## 非目标

- 不删除现有通用 Workspace Runtime Tab 功能。
- 不把已有项目根目录网页工程自动移动或复制到 `.agentos/`。
- 不允许 Workspace Tab 自动发现项目 `.agentos/`。
- 不把 Agent 的整体 `cwd` 改成 `.agentos/`；Agent 仍需读取完整项目上下文。
- 不改变静态产物的 last-good 原子切换、失败回退和 Preview sandbox 安全模型。
- 不引入任意 build command、renderer 提供 cwd、文件 URL 或 ready URL。
- 不为跨 owner 引用构建独立的防伪造安全模型；owner 判定复用现有 host 校验链路。

## 已知取舍

### 项目根 Runtime 变为 `not_initialized` 是一次净回归

改动后，「项目根有 `package.json` 就能在首页预览」这一行为消失，且明确不回退到项目根目录。已有项目在升级后一律显示 `not_initialized`。

这是**显式接受的取舍**，代价由两件事补偿：
- `not_initialized` 空状态提供「让 Agent 创建 Runtime 网页」入口，不让用户卡在死状态。
- 旧的项目根目录 Definition 不删除、不移动；仍被 Workspace Tab 引用时继续可用。

### `.agentos` 命名与形态

`package.json` 中已存在 `agentos` 静态声明字段，再引入同名隐藏目录存在概念混淆；且带 `node_modules` 的完整 npm 工程放在隐藏目录中，编辑器与工具链默认折叠，调试体验一般。

用户已明确确认使用 `.agentos/` 而非 `.agentos/runtime/`，本变更照此执行，此处仅作记录。

## 与现有 Change 的关系

本变更复用 `chg-20260825-local-app-tabs-runtime` 已实现的 Runtime supervisor、静态声明、last-good 和 Preview 隔离，包括其中已生效的 renderer 输入约束与 Preview 创建前后双段校验；本变更只在这些既有校验中增加 owner 维度，不新建校验机制。

本变更明确覆盖 `chg-20260818-agent-command-channel` Revision 2 中“Workspace Tab 与项目首页 Runtime 共享同一个项目 RuntimeInstance / 双 Host”的产品假设：项目专属 `.agentos/` Runtime 只允许 `project-home` host；Workspace Tab 只能消费 workspace-owned Runtime。底层 supervisor 可以复用，产品对象和 host 归属不得互换。

## 成功标准

- 项目 Runtime 只检查并运行 `<project>/.agentos/package.json`。
- 项目根目录的 `package.json` 不再决定项目 Runtime。
- 项目页面不再出现将项目 Runtime 打开为 Workspace Tab 的入口；`workspaceTabs` 也不接受 project-owned Definition。
- 项目 Agent 的 Runtime 网页新建/修改稳定落在 `.agentos/`；未落在 `.agentos/` 时项目 Runtime 页面给出可见提示，而不是静默停留在 `not_initialized`。
- `not_initialized` 状态可以从 UI 直接发起创建，不是终点状态。
- 创建入口不会污染主窗口 Chat：它打开对应项目的独立 Chat 窗口，在其中创建、选中并提交线程。
- Runtime prompt 不会因“有效项目”这一事实普遍注入；它严格遵循 Revision 3 的 sender-capability / Main-owned 编排资格。
- 创建入口及其 Runtime system prompt 要求先读取当前项目文件夹的已有内容和数据，再在 `.agentos/` 内以 Next.js、React、TypeScript 构建数据可视化工作台并完成静态导出验证；Python、Flask、Streamlit 不得作为 Runtime 实现或启动入口。
- Workspace Runtime 不读取 `.agentos/`，其既有手动目录行为不回归。
- `.agentos/` 缺失时不 spawn，创建后可重新发现；符号链接不得逃逸项目根目录。
