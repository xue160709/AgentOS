# M1-01｜Protocol Parser、Binding 与 Receipt Stores

## 目标

先实现无 UI、无真实网络的安全协议核心：deep-link/envelope parser、加密 Binding store、幂等 receipt store。

## 依赖

- `M0-06` 的 M0 Gate 通过。
- 完整阅读 `protocol-v1.md` 与 `technical.md §9–11`。

## Write allowlist

- `electron/agentos-deep-link.ts`（只实现 parser/queue pure core）
- `electron/website-binding-store.ts`（新增）
- `electron/external-task-receipt-store.ts`（新增）
- `electron/agentos-protocol-types.ts`（新增，可选）
- `electron/agentos-deep-link.test.mjs`（新增）
- `electron/website-binding-store.test.mjs`（新增）
- `electron/external-task-receipt-store.test.mjs`（新增）
- `src/project-chat-contract.ts`（仅公共 public binding/error 类型）

禁止写：Main lifecycle、preload、React、network client、broker、Runtime。

## 实施步骤

1. 逐字段实现 `protocol-v1.md` deep link/origin/PairEnvelope/TaskEnvelope/Receipt schema；禁止字段必须拒绝。
2. parser 接收注入的 clock；限制 URL/body/string/TTL，错误码稳定。
3. Binding store 注入 safeStorage adapter 与 temp directory；active origin 唯一，revoke tombstone，public projection 无 ciphertext。
4. safeStorage 不可用/加密失败时拒绝配对，绝不明文回退。
5. receipt store 实现 `{bindingId,idempotencyKey}` 唯一、payload conflict hash、状态迁移、24h/1000 terminal eviction 和 crash recovery。
6. 所有 store atomic temp+rename、corrupt backup；测试不碰真实 userData。

## 必测断言

- `protocol-v1.md §9` 十组向量全部 fixture 化。
- credential 只以 ciphertext 落盘，public/list/error/log 均无明文。
- 相同 key 同 payload 返回同记录；不同 payload 为 `idempotency-conflict`。
- 非 terminal 不被容量淘汰；`thread-created/submitting` 恢复为 terminal rejected。

## 命令

```bash
npm run typecheck
node --test electron/agentos-deep-link.test.mjs electron/website-binding-store.test.mjs electron/external-task-receipt-store.test.mjs
```

## 停止并报告

如果 safeStorage 在 CI 不可用，使用注入 fake 测 store；不得因此增加明文生产 fallback。
