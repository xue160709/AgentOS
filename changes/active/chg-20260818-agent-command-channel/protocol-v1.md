# AgentOS Website Binding Protocol v1

> 状态：Accepted / Planned，未实现  
> 本文是 `agentos://` deep link、HTTPS Ticket 与网站回执的唯一线协议事实源。v1 的目标是“唤醒 + 固定来源取数”，不是在 URL 中传任务。

## 1. 安全模型

- 自定义协议 URL 可被本机任意进程构造，因此 deep link 本身不受信任。
- 唯一网站身份是规范化 HTTPS origin 与该 origin 固定 endpoint 的有效 TLS 连接。
- 配对必须由用户在 AgentOS 中确认；配对后生成的随机 credential 只授予该 origin 向一个固定项目创建新普通线程的能力。
- 网站永远不能读取项目列表、路径、线程 ID、requestId、Transcript、Diff、权限、问题、运行进度或结果。
- deep link 不携带 prompt、项目、thread/session、credential、permission mode 或回执 URL。

## 2. Deep link

### 2.1 语法

```text
agentos://v1/pair?origin=<percent-encoded-origin>&request_id=<request-id>
agentos://v1/task?origin=<percent-encoded-origin>&request_id=<request-id>
```

冻结规则：

- scheme 必须为小写 `agentos`；host 必须为 `v1`；pathname 只能为 `/pair` 或 `/task`。
- query 必须且只能包含一次 `origin` 和一次 `request_id`；未知、重复或空参数拒绝。
- 完整 URL UTF-8 编码后最大 2,048 bytes。
- fragment、username、password、非空 port（deep-link 自身）均拒绝。
- `request_id` 匹配 `^[A-Za-z0-9_-]{16,128}$`，仅用于定位网站后端短期 envelope。
- URL parser 必须使用标准 `URL`；不得用 split/regex 手写解析整个 URL。

### 2.2 Origin 规范化

解码 `origin` 后必须满足：

1. 是绝对 `https:` URL。
2. username/password 为空。
3. pathname 为 `/`，search 与 hash 为空。
4. hostname 是 URL parser 规范化后的有效 DNS name、IPv4、IPv6 或 `localhost`。
5. 默认端口 443 移除；其它显式 TLS 端口保留。
6. scheme/hostname 小写，IPv6 使用 URL 标准方括号形式；禁止尾随点绕过比较。

最终 origin 由 `${url.protocol}//${url.host}` 生成。Binding、endpoint、credential 查找和重复判断只使用该规范值，不能使用 display name 或 HTTP header 的 Origin 值替代。

例：

| 输入 | 结果 |
| --- | --- |
| `https://Example.COM:443/` | `https://example.com` |
| `https://example.com:8443/` | `https://example.com:8443` |
| `http://example.com/` | rejected |
| `https://user@example.com/` | rejected |
| `https://example.com/path` | rejected |

## 3. 固定 HTTPS endpoint

AgentOS 只能访问 deep link origin 下列 exact URL；网站载荷不能提供替代 URL：

```text
GET  {origin}/.well-known/agentos/v1/pair/{request_id}
POST {origin}/.well-known/agentos/v1/pair/{request_id}

GET  {origin}/.well-known/agentos/v1/task/{request_id}
POST {origin}/.well-known/agentos/v1/task/{request_id}
```

- `request_id` 作为一个 percent-encoded path segment；由于字符集受限，编码结果应与原值相同。
- 只接受 TLS 证书校验成功的 HTTPS；不允许 ignore certificate errors。
- redirect policy 固定为 `error`；301/302/303/307/308 都失败，不跟随。
- Electron Main `net.request` 从请求开始到首个 `response` 事件的 deadline 为 5,000ms，总请求 deadline 为 10,000ms。当前 Electron 30 `ClientRequest` 不暴露独立 DNS/connect/TLS 阶段事件或 connect-timeout 参数，因此 5,000ms 首响应 deadline 统一覆盖 DNS、连接、TLS 与响应头等待；不得伪称可单独识别 connect timeout，也不得改用 renderer fetch。
- request/response JSON body 最大 65,536 bytes；超过上限在完整解析前中止。
- `Content-Type` 必须是 `application/json`，允许 `; charset=utf-8`；其它类型失败。
- JSON 顶层必须是 object；未知字段允许忽略，但冻结字段类型/上限不满足则拒绝整个 envelope。
- AgentOS POST 使用 `Cache-Control: no-store`；网站 GET response 应返回 `Cache-Control: no-store`。
- AgentOS 不发送 cookie，也不使用 renderer/browser session；使用 Main 独立网络 client。

所有 epoch 时间使用整数 Unix milliseconds。AgentOS 接受的时钟偏差最多 ±30,000ms；`expires_at - issued_at` 必须大于 0 且不超过 300,000ms。

## 4. Pairing

### 4.1 GET PairEnvelope

请求无 credential：

```http
GET /.well-known/agentos/v1/pair/{request_id}
Accept: application/json
AgentOS-Protocol-Version: 1
```

成功 response：

```json
{
  "version": 1,
  "kind": "pair",
  "request_id": "01JXXXXXXXXXXXXXXXXXXXXXXXXX",
  "origin": "https://example.com",
  "display_name": "Example Site",
  "issued_at": 1787800000000,
  "expires_at": 1787800300000,
  "nonce": "kWjG7LhKq_Mv0zcewEM2yQ"
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `version` | 必须是整数 `1` |
| `kind` | 必须为 `pair` |
| `request_id` | 必须等于 deep link request_id |
| `origin` | 规范化后必须等于 deep link origin |
| `display_name` | trim 后 1–120 UTF-16 code units；仅展示，非身份 |
| `issued_at` / `expires_at` | 符合 §3 TTL 与时钟规则 |
| `nonce` | base64url 字符 16–128；回执原样返回 |

AgentOS 获取并验证后显示配对对话框。仅点击“连接”才生成 Binding；关闭、取消、Escape 或 app quit 都按 rejected 回执处理且不保存 Binding。

### 4.2 POST PairReceipt

用户接受：

```json
{
  "version": 1,
  "kind": "pair_receipt",
  "request_id": "01JXXXXXXXXXXXXXXXXXXXXXXXXX",
  "nonce": "kWjG7LhKq_Mv0zcewEM2yQ",
  "status": "accepted",
  "binding_id": "bnd_01JXXXXXXXXXXXXXXXXXXXXXX",
  "credential": "<base64url-random-credential>"
}
```

如果同 Origin 已经 active 绑定到用户所选同一项目，幂等 accepted 不再次发送 credential：

```json
{
  "version": 1,
  "kind": "pair_receipt",
  "request_id": "01JXXXXXXXXXXXXXXXXXXXXXXXXX",
  "nonce": "kWjG7LhKq_Mv0zcewEM2yQ",
  "status": "accepted",
  "binding_id": "bnd_01JXXXXXXXXXXXXXXXXXXXXXX",
  "already_bound": true
}
```

用户/系统拒绝：

```json
{
  "version": 1,
  "kind": "pair_receipt",
  "request_id": "01JXXXXXXXXXXXXXXXXXXXXXXXXX",
  "nonce": "kWjG7LhKq_Mv0zcewEM2yQ",
  "status": "rejected",
  "code": "user-rejected"
}
```

冻结语义：

- accepted response 中 `binding_id` 匹配 `^bnd_[A-Za-z0-9_-]{16,128}$`；新 Binding 的 credential 是至少 32 random bytes 的 base64url，无 padding。`already_bound: true` 时 credential 必须省略。
- credential 只通过该 HTTPS response 发送一次；之后任何 list/get/日志/回执都不返回。
- AgentOS 必须先用 safeStorage 原子保存 Binding，再 POST accepted；保存失败 POST rejected。
- 同 origin 已 active 绑定同项目：沿用现有 binding，幂等 POST `accepted + already_bound`；不得生成第二条 active Binding，也不得再次暴露 credential。网站若已丢失 credential，用户必须先撤销再重新配对。
- 同 origin 已绑定其它项目：POST rejected `binding-conflict`，UI 引导到连接管理，不覆盖。

Pair rejection code：

```text
user-rejected
invalid-envelope
expired
origin-mismatch
project-not-found
project-path-missing
binding-conflict
credential-storage-unavailable
internal-error
```

## 5. External Task

### 5.1 GET TaskEnvelope

请求：

```http
GET /.well-known/agentos/v1/task/{request_id}
Accept: application/json
Authorization: Bearer <binding-credential>
AgentOS-Binding-Id: bnd_01JXXXXXXXXXXXXXXXXXXXXXX
AgentOS-Protocol-Version: 1
```

TaskReceipt POST 使用相同 `Authorization`、`AgentOS-Binding-Id` 与 protocol version headers；credential 只从 Main safeStorage 解密到该请求的内存 header，完成后不缓存明文。

禁止把 credential 放在 URL、cookie 或日志。成功 response：

```json
{
  "version": 1,
  "kind": "task",
  "request_id": "01JXXXXXXXXXXXXXXXXXXXXXXXXX",
  "origin": "https://example.com",
  "binding_id": "bnd_01JXXXXXXXXXXXXXXXXXXXXXX",
  "issued_at": 1787800000000,
  "expires_at": 1787800300000,
  "idempotency_key": "task_01JXXXXXXXXXXXXXXXXXXXXXX",
  "title": "调整首页首屏文案",
  "task": "把首页首屏标题改得更清楚，并保持当前视觉风格。"
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `version` / `kind` | `1` / `task` |
| `request_id` | 等于 deep link request_id |
| `origin` | 规范化后等于 deep link origin 与 Binding origin |
| `binding_id` | 等于本地 active Binding |
| `issued_at` / `expires_at` | 符合 §3 |
| `idempotency_key` | `^[A-Za-z0-9_-]{16,128}$`；同 Binding 下稳定 |
| `title` | trim 后 1–120 UTF-16 code units；作为线程标题 |
| `task` | trim 后 1–20,000 UTF-16 code units；作为完整用户消息 |

禁止字段：`projectId`、`projectPath`、`threadId`、`sessionId`、`permissionMode`、附件、本地文件 URL、回执 URL、最终结果 callback。出现这些字段时 v1 parser 必须拒绝，而不是忽略，以避免调用方误以为它们生效。

### 5.2 消费与 accepted 线性化

处理顺序固定：

```text
验证 deep link/origin/binding
  -> authenticated GET + envelope validation
  -> lookup idempotency receipt
  -> 持久化普通线程 + thread-created receipt
  -> broker submit，runner 返回 local requestId
  -> receipt = accepted
  -> POST accepted
  -> 根据焦点规则显示/通知项目 Chat 窗口
```

- GET 或 envelope 验证不消费 ticket。
- 线程持久化成功是本地一次性消费点；其后 SDK submit 失败保留失败线程，并记录 terminal rejected。
- accepted 表示线程已持久化且 SDK submit 已返回 requestId，不表示运行成功。
- POST 回执失败不取消或回滚 run。网站以相同 idempotency_key 重试时收到原结果，不创建新线程。
- 同 idempotency_key 但 title/task 不同：返回 `idempotency-conflict`，仍不创建新线程。
- v1 不自动 retry SDK submit；用户可以在保留的失败线程内重新提交。

### 5.3 POST TaskReceipt

accepted：

```json
{
  "version": 1,
  "kind": "task_receipt",
  "request_id": "01JXXXXXXXXXXXXXXXXXXXXXXXXX",
  "idempotency_key": "task_01JXXXXXXXXXXXXXXXXXXXXXX",
  "status": "accepted"
}
```

rejected：

```json
{
  "version": 1,
  "kind": "task_receipt",
  "request_id": "01JXXXXXXXXXXXXXXXXXXXXXXXXX",
  "idempotency_key": "task_01JXXXXXXXXXXXXXXXXXXXXXX",
  "status": "rejected",
  "code": "ticket-expired"
}
```

回执不得含本地 threadId、requestId、项目名称/路径、permission mode、Transcript、错误 stack 或最终结果。

Task rejection code：

```text
invalid-deep-link
binding-not-found
binding-revoked
credential-rejected
ticket-fetch-failed
ticket-invalid
ticket-expired
ticket-consumed
idempotency-conflict
project-not-found
project-path-missing
sdk-submit-failed
internal-error
```

若连 authenticated GET 都未成功，AgentOS 不具备可信任的 receipt destination/body nonce，允许只在本地显示失败而不 POST。

## 6. HTTP status handling

| GET/POST status | AgentOS 处理 |
| --- | --- |
| 200–299 | 校验 Content-Type 与 JSON schema；POST response body忽略但仍受 64KiB 限制 |
| 401/403 | credential rejected；不尝试其它 Binding/项目 |
| 404/410 | ticket invalid/consumed，非 retryable |
| 408/425/429/500–599 | fetch/receipt failed，retryable；遵循一次用户/网站重试，不在 Main 无限循环 |
| 3xx | protocol error；绝不跟随 |
| 其它 4xx | invalid request，非 retryable |

AgentOS v1 单次 deep link 不自动进行网络重试。幂等性用于网站或用户再次触发同一个请求，而不是隐藏重试循环。

## 7. 日志、隐私与 UI

日志可记录：action、规范化 origin host（可选择 hash）、request_id 的前 8 位、HTTP status、error code、耗时、body size、是否命中 idempotency。日志不得记录：

- credential、Authorization、完整 headers；
- task/title 原文、response body、nonce；
- 本地 projectId/threadId/requestId/path 与网站 request_id 的组合映射；
- 用户对权限或 AskUserQuestion 的回答。

配对对话框必须显示规范化 origin；display_name 只作辅助。外部任务错误在 AgentOS 本地提供恢复文案，但不向网站泄漏本地结构。

## 8. 兼容性与版本

- v1 只接受 `version: 1` 和 `agentos://v1/...`；未知版本返回/显示 `unsupported-version`，不做宽松解析。
- 新增可选响应字段可向后兼容；新增请求能力必须通过新协议版本或明确 capability negotiation，不能让 v1 客户端默默执行。
- v1 credential 无网页读取结果能力。未来即使新增状态回调，也必须单独授权并使用新 capability，不得复用当前 credential 的隐含权限。

## 9. 协议级验收向量

实现至少固定以下 fixture：

1. 大小写/default-port origin 归一化成功。
2. HTTP、userinfo、path/query/hash、重复参数、未知参数、超长 URL 拒绝。
3. origin/request_id/binding_id 不一致拒绝。
4. 过期、未来超过 30 秒、TTL 超 5 分钟拒绝。
5. redirect、非 JSON、超 64KiB、timeout 拒绝。
6. safeStorage 不可用时不保存明文、不 accepted。
7. 相同 idempotency_key 重试只创建一个线程并重发同一 receipt。
8. 相同 key 不同 task 返回 `idempotency-conflict`。
9. accepted receipt POST 失败时 run 继续，重试不复制线程。
10. Ticket/deep link 中尝试携带 permissionMode/projectPath/threadId 时整单拒绝。
