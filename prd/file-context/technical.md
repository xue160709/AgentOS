# 本地文件上下文技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `electron/project-content.ts` | 主进程项目文件树、搜索、预览、watch 和路径校验。 |
| `src/project-content.ts` | 渲染层 Project Content adapter 与搜索 session。 |
| `src/components/AppFileTreePane.tsx` | 文件树侧栏 UI。 |
| `src/components/ProjectFilePreviewOverlay.tsx` | 文件预览浮层。 |
| `src/components/AppSearchModal.tsx` | 项目/聊天/知识搜索入口；聊天历史分支通过 `window.desktop.searchChatHistory` 查询 History Search Index。 |
| `src/components/chat/Composer.tsx` | `@` 文件提及和附件入口。 |
| `electron/main.ts` | 文件相关 IPC handler 与附件读取。 |
| `electron/project-content.test.mjs` | Project Content 单元测试。 |

## 数据结构

- `FileTreeNode` / `FileTreeResult`：项目文件树节点与读取结果。
- `ProjectFilePreviewResult`：markdown/json/text/image 预览结果。
- `ProjectFileSearchResult`：项目文件搜索结果。
- `ChatHistorySearchResult`：AppSearch 聊天历史搜索结果，由持久化模块的 History Search Index 返回。
- `ClaudeChatAttachment`：聊天附件元数据、文本正文或图片 base64。
- `ProjectContextEntry`：Context 面板条目。

## 调用链路

```text
文件树/预览/@ 搜索/附件
  -> src/project-content.ts 或 ChatPage
  -> window.desktop.* file APIs
  -> electron/main.ts
  -> electron/project-content.ts / readChatAttachments
  -> 安全校验后返回 UI
```

```text
AppSearch 聊天历史搜索
  -> AppSearchModal
  -> window.desktop.searchChatHistory
  -> electron/main.ts
  -> ChatWorkspaceStore.searchChatHistory
  -> History Search Index / JSON rollout fallback
```

## 日志与调试

- 文件读取失败返回用户可见 message；不要输出完整隐私文件内容。
- 路径逃逸、超限、非支持类型应通过 structured result 表达，不抛到 UI 崩溃。

## 测试与验收

- 自动测试：`electron/project-content.test.mjs`。
- 覆盖点：adapter 路由、desktop 不可用 fallback、搜索竞态、watch 生命周期、路径逃逸、忽略目录、预览与搜索。
- 聊天历史搜索索引覆盖在 `electron/chat-workspace-store.test.mjs`，不属于 Project Content 文件路径安全测试。
- 验收契约：`prd/file-context/acceptance.md`。

## 边界情况

- 预览必须限制在项目根内。
- 文本预览上限为 5MB；图片读取常量为 5MB，但错误文案当前写成 10MB，后续可统一。
- 搜索最多读取 5000 条、返回 24 条，深度上限 10。
- AppSearch 的聊天历史搜索不读取项目文件树；索引损坏时应降级到工作区 JSON/rollout 扫描。
- watch 会过滤忽略目录并防抖推送。

## TODO 对应项

- `TODO.md §14`：补正式验收与文案/常量一致性确认。

## 最近同步

- commit：`fe05e462a76283b9c314ab22f68fdc24f9f199d0`
- 日期：`2026-06-24`
- 变化摘要：增量同步未提交代码观察：AppSearch 聊天历史分支由持久化模块的 History Search Index 承接，项目文件搜索与聊天索引保持不同 Module。
- 待确认：本轮未执行 file-context 正式 `project-verify` 重新盖戳。
