# AgentOS Design Tokens

> 更新日期：2026-07-05  
> 提炼范围：当前仓库已落地的桌面主窗口、设置页、项目首页 A2UI 嵌入层；独立窗口页面消费同一套主 token，不设独立视觉 token。  
> 运行时事实源：`src/theme/tokens.css`。本文件是设计 token 说明与使用约束，不替代 CSS 变量定义。

## 1. Token 来源

| 来源 | 角色 | 说明 |
| --- | --- | --- |
| `src/theme/tokens.css` | 主 token 文件 | 定义字体、字号、间距、圆角、布局、动效、颜色、阴影和明暗主题映射。 |
| `src/style.css` | 应用级使用层 | 引入主 token，并补充 z-index、设置页局部 token、A2UI bridge token 等。 |
| `codex-css-tokens.md` / `codex-css-tokens.css` | 参考来源 | 从本机 Codex.app 静态提取的原始变量清单。本项目只保留精简稳定子集。 |
| `codex-settings-design-system.md` | 设置页参考 | 解释设置页如何对齐 Codex / VS Code 式分组、行式列表与 focus/hover token。 |

当前设计系统采用三层结构：

1. Primitive token：原始色值、字号、间距、圆角、阴影。
2. Semantic token：表面、文本、边框、焦点、控件、状态色。
3. Component / bridge token：Shell 布局、设置页、A2UI、z-index 等具体场景。

主题策略：跟随系统 `prefers-color-scheme`，不要在业务代码里设置 `[data-theme]`。

## 2. 品牌气质

AgentOS 是面向本地项目与长期任务的 Electron 桌面 Agent 工作台。当前视觉语言接近 Codex / VS Code 桌面工作台：

| 维度 | 设计取向 |
| --- | --- |
| 信息密度 | 中高密度，偏工具软件，不做营销式大留白。 |
| 表面 | 主表面扁平，局部使用轻微 glass / elevated surface。 |
| 边界 | 用低透明度边框、hover surface 和小阴影表达层级。 |
| 交互 | 焦点清晰，按钮和行项有稳定 hover/active 状态。 |
| 色彩 | 灰阶为主，蓝色作为主操作/链接/焦点，红橙绿黄表达状态。 |
| 圆角 | 组件多为 6-8px，工作区外框可到 16px。 |

## 3. 字体与字号

### 3.1 Font Family

| Token | 值 | 用途 |
| --- | --- | --- |
| `--font-sans-default` | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | 默认 UI 字体。 |
| `--font-mono-default` | `ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` | 代码、diff、日志等。 |
| `--font-sans` | `var(--vscode-font-family, var(--font-sans-default))` | 应用主字体，允许 VS Code 风格变量覆盖。 |
| `--font-mono` | `var(--vscode-editor-font-family, var(--font-mono-default))` | 应用等宽字体。 |

### 3.2 Font Weight

| Token | 值 | 用途 |
| --- | --- | --- |
| `--font-weight-normal` | `400` | 正文。 |
| `--font-weight-medium` | `500` | 按钮、行标题、标签。 |
| `--font-weight-semibold` | `600` | 分组标题、强调信息。 |
| `--font-weight-bold` | `700` | 强强调，慎用。 |

### 3.3 Type Scale

| Token | 值 | 用途 |
| --- | --- | --- |
| `--text-xs` | `11px` | 辅助标签、状态胶囊、极小元信息。 |
| `--text-sm` | `12px` | 侧栏、设置说明、按钮小字。 |
| `--text-base` | `14px` | 主窗口正文基准。 |
| `--text-lg` | `16px` | 较大正文或局部标题。 |
| `--text-heading-sm` | `18px` | 小标题。 |
| `--text-heading-md` | `20px` | 设置页/面板标题。 |
| `--text-heading-lg` | `24px` | 页面标题。 |
| `--text-xl` | `28px` | 大标题，当前应少量使用。 |

正文默认 `font-size: var(--text-base)`，`line-height: 1.5`，字距保持 `0`。

## 4. 间距、尺寸与布局

### 4.1 Spacing Scale

| Token | 值 | 换算 | 用途 |
| --- | --- | --- | --- |
| `--spacing` | `0.25rem` | 4px | 全局基础步进。 |
| `--padding-panel` | `calc(var(--spacing) * 3)` | 12px | 面板常规内边距。 |
| `--padding-toolbar` | `calc(var(--spacing) * 2)` | 8px | 工具栏内边距。 |
| `--padding-row-x` | `calc(var(--spacing) * 2)` | 8px | 行项水平内边距。 |
| `--padding-row-y` | `var(--spacing)` | 4px | 行项垂直内边距。 |

实际 CSS 大量使用 `calc(var(--spacing) * n)`，优先沿用 4px 步进。常用值：

| 倍数 | 像素 | 用途 |
| --- | --- | --- |
| `1` | 4px | 微间距、图标与文字的紧密间隔。 |
| `2` | 8px | 行项 gap、按钮水平节奏。 |
| `3` | 12px | 面板 padding、紧凑分区。 |
| `4` | 16px | 常规卡片/表单分区。 |
| `6` | 24px | 页面区块之间。 |
| `7` | 28px | 设置页大容器 padding。 |

### 4.2 Shell Layout

| Token | 值 | 用途 |
| --- | --- | --- |
| `--height-toolbar` | `46px` | 主 toolbar 高度。 |
| `--height-toolbar-sm` | `36px` | 小 toolbar 高度。 |
| `--height-toolbar-pane` | `40px` | pane 顶部栏高度。 |
| `--inset-toolbar` | `var(--height-toolbar)` | 内容避让主 toolbar。 |
| `--inset-toolbar-sm` | `var(--height-toolbar-sm)` | 内容避让小 toolbar。 |
| `--spacing-token-safe-header-left` | `0px` | 窗口左侧安全区。 |
| `--spacing-token-safe-header-right` | `0px` | 窗口右侧安全区。 |
| `--spacing-token-safe-header-top` | `0px` | 标题栏/系统按钮安全区。 |
| `--spacing-token-sidebar` | `clamp(240px, 300px, min(520px, calc(100vw - 320px)))` | 侧栏默认宽度。 |
| `--width-sidebar` | `var(--spacing-token-sidebar)` | 侧栏宽度。 |
| `--width-sidebar-min` | `240px` | 侧栏最小宽度。 |
| `--width-sidebar-collapsed` | `0px` | 折叠宽度。 |
| `--width-chrome-toolbar` | `108px` | 桌面窗口控制工具区宽度。 |
| `--size-chrome-control` | `32px` | 顶部 chrome 控件尺寸。 |
| `--sidebar-glass-blur` | `28px` | 侧栏 glass 模糊强度。 |

### 4.3 Component Local Sizes

| Token | 定义位置 | 值 | 用途 |
| --- | --- | --- | --- |
| `--agent-switch-width` | `src/style.css` | `44px` | Agent mode switch 宽度。 |
| `--agent-switch-height` | `src/style.css` | `32px` | Agent mode switch 高度。 |
| `--file-panel-width` | `src/style.css` | `clamp(280px, 28vw, 420px)` | 文件上下文侧面板。 |
| `--project-home-card-compact-height` | `src/style.css` | `292px` | 项目首页 compact card 高度。 |

## 5. 圆角

| Token | 值 | 用途 |
| --- | --- | --- |
| `--corner-radius-scale` | `1` | 全局圆角缩放。 |
| `--radius-xs` | `calc(0.25rem * var(--corner-radius-scale))` | 4px，小标签/小按钮。 |
| `--radius-sm` | `calc(0.375rem * var(--corner-radius-scale))` | 6px，紧凑控件。 |
| `--radius-md` | `calc(0.5rem * var(--corner-radius-scale))` | 8px，默认按钮/输入/行项。 |
| `--radius-lg` | `calc(0.5rem * var(--corner-radius-scale))` | 8px，弹出层/菜单。 |
| `--radius-xl` | `calc(0.75rem * var(--corner-radius-scale))` | 12px，大面板。 |
| `--radius-2xl` | `calc(1rem * var(--corner-radius-scale))` | 16px，大容器。 |
| `--radius-full` | `9999px` | 胶囊、圆形控件。 |
| `--radius-workspace` | `var(--radius-2xl)` | 工作区外框圆角。 |

原则：按钮、输入、行项默认使用 `--radius-md`；重复卡片不超过 8px，除非是工作区/大容器。

## 6. Motion

| Token | 值 | 用途 |
| --- | --- | --- |
| `--transition-duration-basic` | `0.15s` | hover、focus、按钮状态。 |
| `--transition-duration-relaxed` | `0.3s` | 折叠、面板进入、较慢状态变化。 |
| `--transition-ease-basic` | `ease` | 默认缓动。 |
| `--cubic-enter` | `cubic-bezier(0.19, 1, 0.22, 1)` | 进入/展开。 |
| `--cubic-exit-snappy` | `cubic-bezier(0.65, 0, 0.4, 1)` | 离开/快速收起。 |

原则：优先动画 `transform`、`opacity`、`background`、`border-color`、`box-shadow`；避免通过宽高动画造成布局抖动。

## 7. 色彩 Primitive

### 7.1 Gray

| Token | 值 | 用途 |
| --- | --- | --- |
| `--gray-0` | `#ffffff` | 白色、浅色控件前景。 |
| `--gray-50` | `#f9f9f9` | 浅色主表面。 |
| `--gray-100` | `#ededed` | 浅色分隔/弱背景。 |
| `--gray-200` | `#e0e0e0` | 浅色重分隔。 |
| `--gray-400` | `#8e8e8e` | 次级灰。 |
| `--gray-500` | `#5d5d5d` | 深灰正文/图标。 |
| `--gray-700` | `#3a3a3a` | 深色中间灰。 |
| `--gray-800` | `#2a2a2a` | 深色抬升表面。 |
| `--gray-900` | `#181818` | 深色主表面、浅色主文案。 |

### 7.2 Accent / Status

| Token | 值 | 用途 |
| --- | --- | --- |
| `--blue-400` | `#0285ff` | 焦点、active link、进度条。 |
| `--blue-500` | `#0066cc` | 主链接、主按钮强调。 |
| `--red-500` | `#e02e2a` | 错误/危险。 |
| `--green-500` | `#00a240` | 成功/已完成。 |
| `--orange-500` | `#d18616` | 警告/注意。 |
| `--yellow-500` | `#c19c00` | 信息/等待类提示。 |

## 8. 语义色

### 8.1 Light Theme

| Token | 值 | 用途 |
| --- | --- | --- |
| `--color-token-main-surface-primary` | `var(--gray-50)` | 主内容背景。 |
| `--color-token-side-bar-background` | `var(--gray-50)` | 侧栏背景。 |
| `--color-token-bg-primary` | `var(--color-token-side-bar-background)` | 一级背景。 |
| `--color-token-bg-secondary` | `color-mix(in srgb, var(--color-token-bg-primary) 92%, transparent)` | 二级背景。 |
| `--color-token-bg-tertiary` | `color-mix(in srgb, var(--color-token-bg-primary) 85%, transparent)` | 三级背景。 |
| `--color-token-background` | `var(--color-token-bg-primary)` | 通用背景别名。 |
| `--color-token-background-secondary` | `var(--color-token-bg-secondary)` | 通用二级背景别名。 |
| `--color-token-bg-fog` | `color-mix(in oklab, var(--gray-900) 2.5%, transparent)` | 轻雾层。 |
| `--color-token-foreground` | `var(--gray-900)` | 当前主题主前景基准。 |
| `--color-token-text-primary` | `var(--color-token-foreground)` | 主文案。 |
| `--color-token-text-secondary` | `color-mix(in srgb, var(--color-token-foreground) 65%, transparent)` | 次级文案。 |
| `--color-token-text-tertiary` | `color-mix(in srgb, var(--color-token-foreground) 45%, transparent)` | 三级文案/占位。 |
| `--color-token-description-foreground` | `var(--color-token-text-secondary)` | 说明文字。 |
| `--color-token-disabled-foreground` | `color-mix(in srgb, var(--color-token-foreground) 38%, transparent)` | 禁用文字/图标。 |
| `--color-token-border` | `color-mix(in oklab, var(--color-token-foreground) 8%, transparent)` | 默认边框。 |
| `--color-token-border-default` | `var(--color-token-border)` | 默认边框别名。 |
| `--color-token-border-light` | `color-mix(in oklab, var(--color-token-foreground) 5%, transparent)` | 轻分隔。 |
| `--color-token-border-heavy` | `color-mix(in oklab, var(--color-token-foreground) 12%, transparent)` | 强分隔。 |
| `--color-token-focus-border` | `var(--blue-400)` | 焦点边框。 |
| `--color-focus-border` | `var(--color-token-focus-border)` | 焦点边框别名。 |

### 8.2 Dark Theme Overrides

| Token | 暗色值 | 用途 |
| --- | --- | --- |
| `--color-token-main-surface-primary` | `var(--gray-900)` | 深色主背景。 |
| `--color-token-side-bar-background` | `var(--gray-900)` | 深色侧栏背景。 |
| `--color-token-bg-fog` | `color-mix(in oklab, var(--gray-0) 2.5%, transparent)` | 深色轻雾层。 |
| `--color-token-foreground` | `var(--gray-0)` | 深色前景基准。 |
| `--color-token-text-primary` | `color-mix(in oklab, var(--gray-0) 92%, transparent)` | 深色主文案。 |
| `--color-token-border` | `color-mix(in oklab, var(--color-token-foreground) 12%, transparent)` | 深色默认边框。 |
| `--color-token-border-light` | `color-mix(in oklab, var(--color-token-foreground) 8%, transparent)` | 深色轻分隔。 |
| `--color-token-border-heavy` | `color-mix(in oklab, var(--color-token-foreground) 16%, transparent)` | 深色强分隔。 |

其余文本透明度、二级/三级背景仍沿用同名 token 逻辑。

### 8.3 Link / Button / Input / List

| Token | Light | Dark | 用途 |
| --- | --- | --- | --- |
| `--color-token-link` | `var(--blue-500)` | `var(--blue-400)` | 链接。 |
| `--color-token-text-link-foreground` | `var(--color-token-link)` | `var(--color-token-link)` | 链接文字。 |
| `--color-token-text-link-active-foreground` | `var(--blue-400)` | `color-mix(in oklab, var(--blue-400) 85%, white)` | 链接 active。 |
| `--color-token-button-foreground` | `var(--gray-0)` | `var(--gray-900)` | 主按钮文字。 |
| `--color-token-button-background` | `var(--color-token-foreground)` | `var(--gray-0)` | 主按钮背景。 |
| `--color-token-button-border` | `transparent` | `transparent` | 主按钮边框。 |
| `--color-token-button-secondary-hover-background` | `color-mix(in oklab, var(--color-token-foreground) 10%, transparent)` | 同名覆盖 | 次级按钮 hover。 |
| `--color-token-input-background` | `var(--gray-0)` | `color-mix(in oklab, var(--gray-0) 6%, transparent)` | 输入背景。 |
| `--color-token-input-border` | `var(--color-token-border)` | `var(--color-token-border)` | 输入边框。 |
| `--color-token-input-foreground` | `var(--color-token-foreground)` | `var(--color-token-text-primary)` | 输入文字。 |
| `--color-token-input-placeholder-foreground` | `var(--color-token-text-tertiary)` | `var(--color-token-text-tertiary)` | placeholder。 |
| `--color-token-list-hover-background` | `color-mix(in oklab, var(--color-token-foreground) 6%, transparent)` | `color-mix(in oklab, var(--color-token-foreground) 8%, transparent)` | 列表 hover。 |
| `--color-token-list-active-selection-background` | `color-mix(in oklab, var(--color-token-foreground) 9%, transparent)` | `color-mix(in oklab, var(--color-token-foreground) 11%, transparent)` | 列表选中。 |
| `--color-token-list-active-selection-foreground` | `var(--color-token-foreground)` | `var(--color-token-text-primary)` | 列表选中文字。 |
| `--color-token-toolbar-hover-background` | `var(--color-token-list-hover-background)` | `var(--color-token-list-hover-background)` | 工具栏 hover。 |

### 8.4 Menu / Overlay / Icon / Status

| Token | Light | Dark | 用途 |
| --- | --- | --- | --- |
| `--color-token-dropdown-background` | `var(--gray-0)` | `color-mix(in oklab, var(--gray-900) 94%, var(--gray-0))` | 下拉背景。 |
| `--color-token-menu-background` | `var(--color-token-dropdown-background)` | 同名覆盖 | 菜单背景。 |
| `--color-token-menu-border` | `var(--color-token-border)` | `var(--color-token-border)` | 菜单边框。 |
| `--color-token-simple-scrim` | `rgb(0 0 0 / 0.2)` | `rgb(0 0 0 / 0.5)` | 弹窗遮罩。 |
| `--color-token-icon-foreground` | `var(--color-token-text-secondary)` | 同名逻辑 | 默认图标。 |
| `--color-token-icon-primary` | `var(--color-token-text-primary)` | 同名逻辑 | 主图标。 |
| `--color-token-icon-secondary` | `var(--color-token-text-secondary)` | 同名逻辑 | 次级图标。 |
| `--color-token-icon-tertiary` | `var(--color-token-text-tertiary)` | 同名逻辑 | 三级图标。 |
| `--color-token-error-foreground` | `var(--red-500)` | `var(--red-500)` | 错误/危险文字。 |
| `--color-token-editor-error-foreground` | `var(--red-500)` | `var(--red-500)` | 编辑器错误。 |
| `--color-token-editor-warning-foreground` | `var(--orange-500)` | `var(--orange-500)` | 编辑器警告。 |
| `--color-token-progress-bar-background` | `var(--blue-400)` | `var(--blue-400)` | 进度条。 |

### 8.5 Sidebar / Window Chrome

| Token | Light | Dark | 用途 |
| --- | --- | --- | --- |
| `--color-token-sidebar-glass-surface` | `color-mix(in oklab, var(--gray-0) 48%, transparent)` | `color-mix(in oklab, var(--gray-800) 36%, transparent)` | 侧栏 glass 表面。 |
| `--color-token-sidebar-glass-fallback` | `color-mix(in oklab, var(--gray-0) 92%, var(--gray-50))` | `color-mix(in oklab, var(--gray-800) 94%, var(--gray-900))` | 无 backdrop-filter 时侧栏背景。 |
| `--color-token-sidebar-edge-border` | `color-mix(in oklab, var(--gray-900) 10%, transparent)` | `color-mix(in oklab, var(--gray-0) 12%, transparent)` | 侧栏边界。 |
| `--codex-titlebar-tint` | `color-mix(in oklab, var(--gray-0) 72%, transparent)` | `color-mix(in oklab, var(--gray-900) 88%, transparent)` | 标题栏 tint。 |

## 9. 阴影与层级

### 9.1 Shadow

| Token | Light | Dark | 用途 |
| --- | --- | --- | --- |
| `--shadow-xs` | `0px 1px 2px rgb(0 0 0 / 0.08)` | `0px 1px 2px rgb(0 0 0 / 0.28)` | 小控件 elevation。 |
| `--shadow-xl` | `0px 8px 16px -4px rgb(0 0 0 / 0.12)` | `0px 8px 16px -4px rgb(0 0 0 / 0.28)` | 浮层/面板。 |
| `--shadow-2xl` | `0px 16px 32px -8px rgb(0 0 0 / 0.19)` | `0px 16px 32px -8px rgb(0 0 0 / 0.36)` | 高层 modal/overlay。 |

### 9.2 Z-index

| Token | 值 | 用途 |
| --- | --- | --- |
| `--z-layer-main` | `0` | 主内容。 |
| `--z-layer-side-panel` | `1` | 侧面板。 |
| `--z-layer-modal-host` | `2` | modal host。 |
| `--z-layer-sidebar` | `2` | 侧栏。 |
| `--z-layer-splitter` | `4` | 分栏拖拽条。 |
| `--z-layer-chrome` | `10` | 窗口 chrome。 |
| `--z-layer-local-overlay` | `20` | 局部 overlay。 |
| `--z-layer-menu` | `80` | 普通菜单。 |
| `--z-layer-project-menu` | `90` | 项目菜单。 |
| `--z-layer-popover` | `10030` | popover。 |
| `--z-layer-context-menu` | `10040` | context menu。 |
| `--z-layer-floating` | `10060` | floating UI。 |
| `--z-layer-modal` | `10200` | modal。 |
| `--z-layer-modal-top` | `10300` | 顶层 modal。 |
| `--z-layer-system-overlay` | `2147483647` | 系统级遮罩，如护眼模式。 |

## 10. 组件级 Token

### 10.1 Settings Page

定义位置：`src/style.css` `.settings-page`。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--settings-focus-border` | `color-mix(in oklab, var(--color-token-foreground) 42%, transparent)` | 设置页控件焦点边框。 |
| `--settings-focus-ring` | `color-mix(in oklab, var(--color-token-foreground) 16%, transparent)` | 设置页控件 focus ring。 |
| `--settings-row-surface` | `color-mix(in oklab, var(--color-token-main-surface-primary) 96%, var(--color-token-foreground))` | 设置行默认表面。 |
| `--settings-row-surface-strong` | `color-mix(in oklab, var(--color-token-main-surface-primary) 90%, var(--color-token-foreground))` | 强化设置行表面。 |
| `--settings-row-surface-soft` | `color-mix(in oklab, var(--color-token-main-surface-primary) 98%, var(--color-token-foreground))` | 轻设置行表面。 |
| `--settings-selected-indicator` | `color-mix(in oklab, var(--color-token-foreground) 72%, transparent)` | 选中指示。 |

设置页模式：分组标题 + bordered row stack + segmented control。不要把每个设置项都做成独立浮卡。

### 10.2 A2UI Project Home Bridge

定义位置：`src/style.css` `.project-home-surface`。

| Token | 值 |
| --- | --- |
| `--a2ui-color-background` | `transparent` |
| `--a2ui-color-surface` | `transparent` |
| `--a2ui-color-on-surface` | `var(--color-token-text-primary)` |
| `--a2ui-color-on-background` | `var(--color-token-text-primary)` |
| `--a2ui-color-border` | `var(--color-token-border-light)` |
| `--a2ui-color-primary` | `var(--color-token-button-background)` |
| `--a2ui-color-on-primary` | `var(--color-token-button-foreground)` |
| `--a2ui-border` | `1px solid var(--a2ui-color-border)` |
| `--a2ui-border-radius` | `var(--radius-md)` |
| `--a2ui-card-border` | `0` |
| `--a2ui-card-background` | `transparent` |
| `--a2ui-card-border-radius` | `var(--radius-md)` |
| `--a2ui-card-box-shadow` | `none` |
| `--a2ui-card-margin` | `0` |
| `--a2ui-card-padding` | `0` |
| `--a2ui-column-gap` | `calc(var(--spacing) * 2)` |
| `--a2ui-row-gap` | `calc(var(--spacing) * 2)` |
| `--a2ui-list-gap` | `calc(var(--spacing) * 2)` |
| `--a2ui-spacing-xs` | `calc(var(--spacing) * 1)` |
| `--a2ui-spacing-s` | `calc(var(--spacing) * 1.5)` |
| `--a2ui-spacing-m` | `calc(var(--spacing) * 2)` |
| `--a2ui-spacing-l` | `calc(var(--spacing) * 3)` |
| `--a2ui-font-size-xs` | `var(--text-xs)` |
| `--a2ui-font-size-s` | `var(--text-sm)` |
| `--a2ui-font-size-m` | `var(--text-base)` |
| `--a2ui-font-size-l` | `var(--text-lg)` |
| `--a2ui-font-size-xl` | `var(--text-heading-sm)` |
| `--a2ui-font-size-2xl` | `var(--text-heading-md)` |
| `--a2ui-line-height-body` | `1.45` |
| `--a2ui-line-height-headings` | `1.25` |
| `--a2ui-text-caption-color` | `var(--color-token-text-tertiary)` |
| `--a2ui-text-a-color` | `var(--color-token-text-link-foreground)` |

## 11. 待收敛项

### 11.1 引用但未在主 token 定义的变量

当前 `src/style.css` 有少量 fallback / 预留变量引用，尚未进入 `src/theme/tokens.css`：

| Token | 情况 | 建议 |
| --- | --- | --- |
| `--color-token-main-surface-secondary` | 被引用但未在主 token 中定义。 | 若成为长期语义，补入 `tokens.css`；否则改用 `--color-token-background-secondary`。 |
| `--color-token-success-foreground` | 有 fallback 到 focus color 的引用。 | 若成功态常用，补为 `var(--green-500)`。 |
| `--danger` | 局部 fallback 为 `#d14343`。 | 替换为 `--color-token-error-foreground` 或定义局部 alias。 |
| `--context-color` / `--home-card-span` | 运行时/组件局部变量。 | 保持局部，不进入全局 token。 |

## 12. 使用规则

1. 新 UI 优先使用 `src/theme/tokens.css` 中的语义 token，不直接写 hex。
2. 颜色从语义 token 开始选：表面用 `--color-token-main-surface-primary` / `--color-token-background-secondary`，文本用 `--color-token-text-*`，边框用 `--color-token-border*`。
3. 间距统一使用 `calc(var(--spacing) * n)`，除非是平台安全区、固定图标尺寸或第三方嵌入尺寸。
4. 圆角默认 `--radius-md`；胶囊用 `--radius-full`；大容器最多使用 `--radius-2xl`。
5. 交互状态使用现有 hover/active/focus token：`--color-token-list-hover-background`、`--color-token-list-active-selection-background`、`--color-token-focus-border`。
6. 明暗主题只改 token 映射，不在组件里手写两套颜色。
7. 组件确实需要专属 token 时，先定义在组件根 class 上，命名为 `--<component>-<role>`，稳定复用后再提升到 `src/theme/tokens.css`。
8. 第三方/嵌入层使用 bridge token，如 A2UI 的 `--a2ui-*`，不要让第三方默认主题直接泄露到主 UI。
9. 独立窗口页面同样必须引入 `src/theme/tokens.css` 并消费主语义 token，不单独创建另一套视觉 token。
10. 修改 `.codex/` 或规则不涉及本文件；修改视觉 token 时优先同步本文件，避免设计文档与运行时代码漂移。

## 13. 快速索引

| 需求 | 优先使用 |
| --- | --- |
| 页面背景 | `--color-token-main-surface-primary` |
| 次级背景 | `--color-token-background-secondary` |
| 主文本 | `--color-token-text-primary` |
| 次级文本 | `--color-token-text-secondary` |
| 辅助文本 | `--color-token-text-tertiary` |
| 输入背景 | `--color-token-input-background` |
| 输入边框 | `--color-token-input-border` |
| hover 行背景 | `--color-token-list-hover-background` |
| active 行背景 | `--color-token-list-active-selection-background` |
| 链接 | `--color-token-text-link-foreground` |
| 错误 | `--color-token-error-foreground` |
| 成功 | `--green-500`，后续建议补 `--color-token-success-foreground` |
| 警告 | `--orange-500` |
| 焦点 | `--color-token-focus-border` |
| 小按钮/行项圆角 | `--radius-md` |
| 胶囊 | `--radius-full` |
| 浮层阴影 | `--shadow-xl` / `--shadow-2xl` |
| 常规动画 | `--transition-duration-basic var(--transition-ease-basic)` |
