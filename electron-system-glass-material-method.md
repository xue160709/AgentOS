# 系统玻璃材质实现方法

> 更新时间：2026-07-07  
> 适用范围：Electron 桌面应用的独立浮窗、命令窗口、轻量工具面板。  
> 参考项目：[Javis603/token-monitor](https://github.com/Javis603/token-monitor)。

## 目标效果

系统玻璃材质不是单纯的半透明背景。理想效果由两层组成：

1. 系统窗口材质：让操作系统负责真实的桌面背景采样、模糊、噪声和混合。
2. CSS 玻璃表面：让应用自己控制颜色、边框、高光、阴影、圆角和兜底模糊。

这样做的好处是：macOS 上能接近原生 Vibrancy；Windows 上能优先使用 Acrylic；在 Linux、旧版 Windows 或系统材质不可用时，也能退化成有质感的半透明玻璃面板。

## Token Monitor 的实现思路

Token Monitor 的毛玻璃由 Electron 原生材质和 CSS 共同完成。

### 1. Electron 窗口透明化

主窗口是无边框窗口：

```js
new BrowserWindow({
  frame: false,
  backgroundColor: '#00000000',
  transparent: !(process.platform === 'win32' && glass),
  ...(process.platform === 'darwin' && glass
    ? { vibrancy: 'hud', visualEffectState: 'active' }
    : {}),
  ...(process.platform === 'win32' && glass
    ? { backgroundMaterial: 'acrylic' }
    : {}),
})
```

关键点：

- macOS 使用 `vibrancy: 'hud'` 和 `visualEffectState: 'active'`。
- Windows 使用 `backgroundMaterial: 'acrylic'`。
- `backgroundColor: '#00000000'` 让窗口底色保持透明。
- Windows acrylic 开启后不一定适合再使用 `transparent: true`，Token Monitor 选择 acrylic 模式下 `transparent: false`。

参考：

- [Token Monitor main.js BrowserWindow 配置](https://github.com/Javis603/token-monitor/blob/main/src/electron/main.js#L2223-L2238)
- [Token Monitor applyNativeMaterial](https://github.com/Javis603/token-monitor/blob/main/src/electron/main.js#L1064-L1073)

### 2. CSS 变量控制玻璃色

Token Monitor 用变量控制玻璃颜色与透明度：

```css
:root {
  --glass-rgb: 48, 52, 56;
  --glass-alpha: 0.68;
  --glass: rgba(var(--glass-rgb), var(--glass-alpha));
}
```

用户设置里的 Glass 滑杆会改 `--glass-alpha`，主题色会改 `--glass-rgb`。这样玻璃层不是写死的，可以跟随主题与用户偏好。

参考：

- [Token Monitor styles.css 玻璃变量](https://github.com/Javis603/token-monitor/blob/main/src/electron/renderer/styles.css#L1-L20)
- [Token Monitor app.js 外观变量更新](https://github.com/Javis603/token-monitor/blob/main/src/electron/renderer/app.js#L2896-L2906)

### 3. 主玻璃面板使用多层背景

核心面板使用多层渐变、半透明底色、边框、阴影和 backdrop blur：

```css
.shell {
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(var(--overlay-rgb), var(--highlight-alpha)), rgba(var(--overlay-rgb), 0.022)),
    linear-gradient(135deg, rgba(var(--overlay-rgb), 0.035), rgba(0, 0, 0, 0.09)),
    var(--glass);
  box-shadow:
    0 22px 55px var(--shadow),
    inset 0 1px 0 rgba(var(--overlay-rgb), 0.13);
  -webkit-backdrop-filter: blur(32px) saturate(115%);
  backdrop-filter: blur(32px) saturate(115%);
}
```

这个组合里每一项都有作用：

- `var(--glass)`：决定主要 tint。
- 第一层渐变：制造顶部高光。
- 第二层渐变：制造斜向深浅变化，避免平板感。
- `border`：让玻璃边缘可见。
- `box-shadow`：让窗口浮起来。
- `backdrop-filter`：在 CSS 层做兜底模糊与饱和。

参考：[Token Monitor styles.css .shell](https://github.com/Javis603/token-monitor/blob/main/src/electron/renderer/styles.css#L61-L80)

## 在 Electron 项目中复用的完整方法

### 1. 主进程：抽出窗口材质配置

建议为玻璃窗口单独写一个材质函数，不要散落在 `BrowserWindow` 配置里。

```ts
import type { BrowserWindowConstructorOptions } from 'electron'

function getGlassWindowMaterialOptions(): Pick<
  BrowserWindowConstructorOptions,
  'backgroundColor' | 'backgroundMaterial' | 'transparent' | 'vibrancy' | 'visualEffectState'
> {
  if (process.platform === 'darwin') {
    return {
      backgroundColor: '#00000000',
      transparent: true,
      vibrancy: 'hud',
      visualEffectState: 'active',
    }
  }

  if (process.platform === 'win32') {
    return {
      backgroundColor: '#00000000',
      backgroundMaterial: 'acrylic',
      transparent: false,
    }
  }

  return {
    backgroundColor: '#00000000',
    transparent: true,
  }
}
```

创建窗口时套用：

```ts
const win = new BrowserWindow({
  width: 480,
  height: 372,
  frame: false,
  show: false,
  resizable: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  ...getGlassWindowMaterialOptions(),
  webPreferences: {
    preload: path.join(__dirname, 'preload.mjs'),
  },
})
```

### 2. Preload：暴露平台材质能力

渲染层需要知道当前窗口大概运行在哪种材质下，便于切换 CSS。

```ts
const desktopAdapter = {
  platform: process.platform,
  windowEffects: {
    macVibrancy: process.platform === 'darwin',
    windowsAcrylic: process.platform === 'win32',
    windowsTitlebarOverlay: process.platform === 'win32',
  },
}
```

对应类型：

```ts
export type DesktopAPI = {
  platform: NodeJS.Platform
  windowEffects?: {
    macVibrancy: boolean
    windowsAcrylic: boolean
    windowsTitlebarOverlay: boolean
  }
}
```

### 3. 渲染入口：写入材质状态

```ts
const windowEffects = window.desktop?.windowEffects

if (windowEffects?.macVibrancy) {
  document.documentElement.dataset.voiceWindowEffects = 'mac-vibrancy'
} else if (windowEffects?.windowsAcrylic) {
  document.documentElement.dataset.voiceWindowEffects = 'windows-acrylic'
} else {
  document.documentElement.dataset.voiceWindowEffects = 'css-glass'
}
```

这样 CSS 可以用 `html[data-voice-window-effects='...']` 精细区分平台。

### 4. CSS：先让根和 body 透明

```css
:root {
  background: transparent;
  color: var(--color-token-text-primary);
}

body {
  margin: 0;
  min-width: 100vw;
  min-height: 100vh;
  overflow: hidden;
  background: transparent;
}

#voice-app {
  width: 100vw;
  height: 100vh;
}
```

如果这里用了不透明背景，系统材质会被盖住。

### 5. CSS：定义玻璃 token

```css
:root {
  --voice-glass-window: color-mix(in oklab, var(--color-token-main-surface-primary) 56%, transparent);
  --voice-glass-window-strong: color-mix(in oklab, var(--color-token-main-surface-primary) 72%, transparent);
  --voice-glass-control: color-mix(in oklab, var(--color-token-input-background) 58%, transparent);
  --voice-glass-control-hover: color-mix(in oklab, var(--color-token-foreground) 7%, transparent);
  --voice-glass-line: color-mix(in oklab, var(--color-token-border-heavy) 74%, transparent);
  --voice-glass-line-soft: color-mix(in oklab, var(--color-token-border) 58%, transparent);
  --voice-glass-highlight: color-mix(in oklab, var(--color-token-foreground) 7%, transparent);
  --voice-glass-shadow: color-mix(in oklab, var(--color-token-foreground) 24%, transparent);
}
```

原则：

- 外层窗口用更透明的 surface。
- 输入框、确认卡、结果卡使用稍强一点的 surface。
- 边框要半透明，但比普通面板略强，玻璃边缘才站得住。
- 阴影不要太重，否则会像普通弹窗，不像系统面板。

### 6. CSS：整窗玻璃表面

```css
.voice-window {
  position: relative;
  isolation: isolate;
  width: 100vw;
  height: 100vh;
  border: 1px solid var(--voice-glass-line);
  border-radius: var(--radius-2xl);
  background:
    linear-gradient(180deg, var(--voice-glass-highlight), transparent 36%),
    linear-gradient(135deg, color-mix(in oklab, var(--color-token-focus-border) 8%, transparent), transparent 44%),
    var(--voice-glass-window);
  box-shadow:
    0 26px 72px -34px var(--voice-glass-shadow),
    inset 0 1px 0 color-mix(in oklab, var(--color-token-foreground) 13%, transparent);
  overflow: hidden;
  -webkit-backdrop-filter: blur(30px) saturate(125%);
  backdrop-filter: blur(30px) saturate(125%);
  -webkit-app-region: drag;
}
```

注意：

- `overflow: hidden` 用于裁剪圆角内的背景和模糊。
- `isolation: isolate` 避免内部混合层影响外部。
- `-webkit-app-region: drag` 让无边框窗口可拖动。
- 交互区域必须设回 `-webkit-app-region: no-drag`。

```css
.voice-window__header,
.voice-window__confirm,
.voice-window__clarify,
.voice-window__composer,
.voice-window__result,
.voice-window__hint,
.voice-window__error {
  -webkit-app-region: no-drag;
}
```

### 7. CSS：按平台微调 tint

```css
html[data-voice-window-effects='mac-vibrancy'] .voice-window {
  background:
    linear-gradient(180deg, color-mix(in oklab, var(--color-token-foreground) 9%, transparent), transparent 42%),
    color-mix(in oklab, var(--color-token-main-surface-primary) 34%, transparent);
}

html[data-voice-window-effects='windows-acrylic'] .voice-window {
  background:
    linear-gradient(180deg, color-mix(in oklab, var(--color-token-foreground) 8%, transparent), transparent 40%),
    color-mix(in oklab, var(--color-token-main-surface-primary) 46%, transparent);
}
```

macOS vibrancy 本身已经比较强，所以 CSS tint 可以更轻。Windows acrylic 通常更依赖应用 tint，所以可以略厚一点。

### 8. CSS：内部控件也要玻璃化

外层玻璃化后，内部控件不能继续用完全不透明的 surface，否则视觉会割裂。

```css
.voice-window__mode,
.voice-window__hint:not(:empty),
.voice-window__error:not(:empty),
.voice-window__result:not(:empty),
.voice-window__confirm,
.voice-window__clarify {
  border: 1px solid var(--voice-glass-line-soft);
  background: var(--voice-glass-control);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--color-token-foreground) 5%, transparent);
}

.voice-command-composer.chat-composer {
  border-color: var(--voice-glass-line);
  background: var(--voice-glass-control);
  box-shadow:
    0 12px 34px -28px var(--voice-glass-shadow),
    inset 0 1px 0 color-mix(in oklab, var(--color-token-foreground) 8%, transparent);
  -webkit-backdrop-filter: blur(24px) saturate(118%);
  backdrop-filter: blur(24px) saturate(118%);
}
```

按钮 hover 和 active 状态也要使用半透明状态层：

```css
.voice-window__mode button:hover,
.voice-window__ghost:hover,
.voice-command-composer .composer-icon-button:hover {
  background: var(--voice-glass-control-hover);
}

.voice-window__mode button.is-active {
  background: var(--voice-glass-window-strong);
}
```

## Windows 无毛玻璃时会长什么样

如果 Windows 环境不支持 Acrylic，或者 Electron/系统版本没有真正启用 DWM 背景材质，界面不会呈现 macOS 那种实时模糊桌面背景。

退化后的视觉表现是：

- 一块半透明的深色或浅色面板。
- 能看到玻璃 tint、边框、高光、阴影和圆角。
- 背后内容不会明显实时模糊，更多像“染色的透明浮窗”。
- `backdrop-filter` 如果可用，会对窗口内部背后内容产生 CSS 模糊；如果不可用，则只保留半透明层和阴影。

这是合理兜底。不要为了追求 Windows 旧环境毛玻璃而硬上不稳定 hack，除非明确接受平台兼容风险。

## 本项目当前落地

本项目已将命令窗口改为系统玻璃材质优先：

- `electron/main.ts`
  - `getVoiceCommandWindowMaterialOptions()`：封装 macOS `vibrancy: 'hud'`、Windows `backgroundMaterial: 'acrylic'` 和其它平台透明兜底。
  - `createVoiceCommandWindow()`：套用该材质配置。
- `electron/preload.ts`
  - `window.desktop.windowEffects.windowsAcrylic`：向渲染层暴露 Windows acrylic 状态。
- `src/desktop-api.ts`
  - 补齐 `windowEffects.windowsAcrylic` 类型。
- `src/voice-main.tsx`
  - 根据平台写入 `document.documentElement.dataset.voiceWindowEffects`。
- `src/voice.css`
  - 新增 `--voice-glass-*` token。
  - `.voice-window` 改为透明玻璃表面。
  - 输入框、模式切换、确认卡、澄清列表、结果/错误/提示卡改为半透明控件层。

## 验证建议

代码级自检：

```bash
npm run typecheck
node --test electron/omni-intent-voice.test.mjs
git diff --check
```

人工视觉 smoke：

1. macOS：启动 Electron 应用，打开命令窗口，确认窗口背景能透出系统 Vibrancy，且控件文字清晰。
2. Windows 11：打开命令窗口，确认 Acrylic 可见；如果不可见，应至少看到半透明面板、边框、高光与阴影。
3. 浅色/深色系统主题各看一次，确认文字对比度、边框和输入框可读。
4. 拖动命令窗口，确认非交互区域可拖动，按钮和输入框区域不误触拖拽。
5. 输入一条命令并提交，确认玻璃样式没有影响 `data-testid` 和原有命令链路。

## 常见坑

- `body` 或根节点有不透明背景，会盖住系统材质。
- 外层用了 `backdrop-filter`，但窗口本身不是透明窗口，桌面不会透出来。
- 无边框窗口忘了给交互区域设置 `-webkit-app-region: no-drag`，按钮和输入框会点不动。
- Windows acrylic 下强行 `transparent: true`，可能导致材质异常或窗口绘制问题。
- 内部卡片过于不透明，会让整个界面看起来像普通弹窗。
- 玻璃 alpha 太低会影响可读性；太高则看不到材质。一般外层 34%-56% tint，控件层 58%-72% tint 比较稳。
