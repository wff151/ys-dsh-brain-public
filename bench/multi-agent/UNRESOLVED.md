# 多 Agent 任务 · 待验证 / 待细化项

原则：假设必须在此单列并标注状态，禁止在设计里当事实使用（M-001/M-003 教训）。

## 已验证项（从待验证清单移除，留档备查）

| 项 | 状态 | 验证日期 | 依据 |
|---|---|---|---|
| subagent 独立 sessionId | ✅ 已验证 | 2026-09-30 | child-agent.ts：ctx.agents.create() + meta.parentSession 血缘 + childCtx 独立 + childSession 独立 + catalog childId |
| portable 跨 session 读 | ✅ 已验证 | 2026-09-30 | store.getPortableDoc(任意 key)；resume session_id 参数；findResumableSessions 全量扫描 |
| resume 渲染完整性 | ✅ 已验证 | 2026-09-30 | M-001 修复后：progress 空串过滤 + cap 20 + 单条 120 截断 |
| **黑板读回必须覆盖 public 路径（b+ 通道缺口）** | ✅ 已验证（实证，非待办） | 2026-09-30 | V0 naive 组 4 条 remember 写入 readback found=false = 通道只读 portable 的缺陷，非模型失败。重放验证（judge-naive-public.mjs：独立 store 重写 + listAllPublicMemories 按 issues 内容匹配）4/4 命中。**结论：b+ 通道的 readback 必须同时读 portable（resume）与 public（search/listAllPublicMemories），否则对 remember 写入的 trace 判 fail 是通道缺陷** |
| **V2 黑板通道实证（P 组 6/6 任务读回 4/4）** | ✅ 已验证 | 2026-10-02 | V2 H-协作：P 组全部任务成功取回（resume 读 portable + search 词级匹配 public），传递完整性 100%。search 全词匹配缺陷修复为词级匹配后稳定。跨 session 黑板语义在真实 store 上成立 |
| **V2 判定执行事实** | ✅ 已记录 | 2026-10-02 | ①T5 s1 在 8192 max_tokens 下截断（声明块缺失）→ T5 单独 16384（任务 token 需求差异适配）；②llama-server 无 --reasoning-budget 时 reasoning 占满预算致 content 空（V1 前科复发）→ 重启带 4096；③T1/T4/T8 stage2 题面 key_facts 泄露（N 组虚高）→ 改题面后 N 组全 0/4 |

## 待细化（设计细节，V0/V1 前定）

### U1. 黑板折叠（fold）字段规则 —— 未用（V2 单轮交接未触发折叠）
事件流 → 当前状态的折叠规则未定：
- 哪些字段参与"最新"判定？（title/goal/unresolved/result/tags 各自按 agent 取最新一条，还是整体快照？）
- agent 标识放 source（'strategy'/'analysis'/'executor'）还是 tags？
- 折叠输出的结构（矛盾清单、方向假设、事件流的形态）。
V0/V1/V2 均为单轮/两轮交接，折叠未实际触发。V3 真多轮多 agent 时需实现（纯函数，放规则调度层）。

### U2. 三层矛盾 rubric 的判定措辞 —— V0 已用，未打磨成独立评测项
"不解决→验收无法达成"等判据已转成 V0/V2 提示词格式要求；三层分类本身未作为独立指标评测（V0 的 primary_clear/contradiction 是更粗的显式化指标）。

### U3. 空位采集实现 —— 未实现（规则调度层未落地）
占用率采集频率、报警阈值、响应方。80% 阈值已预注册，采集方式待定。

### U4. 四角色 ↔ 官方 dsh-subagent 的 provider 映射 —— V2 未拆真实 subagent
- 每个角色一个 provider 实例（strategy/analysis/executor），各自 prompt、工具权限、上下文隔离。
- 子 agent 独立 session 已验证，但"角色 prompt 怎么写、工具怎么 restrict"未设计。
- **V2 用 b+ 通道 + 手工跨 session 模拟交接**（P 组读回经真实 store/resume/search，但 agent 编排是 runner 代调）。真拆官方 subagent 前需先完成 U8 编排验证。

### U5. public 事件流检索性能 —— 数据量增长后评估
全表 entries() 扫描，个人规模够用；若黑板事件流长期积累（千条级），search 语义检索是否足够、是否需要折叠缓存。不预做。

## 待测（需要跑模型）

### U6. 模型自觉对账率 —— 未测（V2 未建多 agent 编排）
阶段切换时模型是否主动发现版本落后。阈值 70% 已预注册；<70% 则加 runner 注入对账检查。
V2 的 P 组轮 1 全部主动发起取回（0% 未发起），但那是"被提示声明取回"而非"自觉对账"——自觉对账需要无提示的自然交接，V3 测。

### U7. 战略 agent 方向调整被用户否决率 —— V2 后测（推迟）
>50% 视为判断质量不足或权限边界不清（DESIGN.md 可证伪条件）。H-方向未启动，随其推迟。

### U8. 官方 subagent 编排能力（其余 7 项）—— V3 前置（未测）
V2 前只验证了"public store 跨 subagent 共享（第 2 项）"。其余 7 项未查：
1. subagent 多 agent 顺序/并行调用（continuation-activation.ts / child-agent.ts / continuation-messages.ts）
2. agent 间黑板传递：同 store 直接读写 vs 显式传 state 引用
3. 错误传播：一个 agent 失败时后续 agent 收到什么
4. 确认机制：调度层报警后矛盾分析 agent 怎么被重新唤起
5. subagent 调用的返回结构（完整 trace？摘要？仅 final message？）→ 决定 runner trace 与折叠写法
6. 角色 prompt 隔离粒度（独立 system prompt vs 共享父 prompt）
7. 成本可控性（多 agent token 倍数——a 变体 5 连挂教训）
源码指针：`（官方 dsh 源码，第三方，未包含）`、`subagent-in-process-driver\src\index.ts`、`subagent-spawn-in-process\src\index.ts`、`core\agent-loop\src\agent.ts`、`core\agent\src\index.ts`、`storage\storage-domain\src\index.ts`、`packages/dsh-memory\src\store.ts` / `tests\v0-bridge.mjs`。

## V2 新增留档（判定时按事实记录，不升格为结论）

- **T6-P 使用效率缺口**：P 组取回内容完整（含"单一供应商/30%"），但决策文本未复述这两个 key（无等价表达）。记录为"取了但没用进表述"，非协议有损；T6-P 决策方向仍正确。
- **T1/T5/T8 等价命中**：12 人周=3人×4周；"MySQL 5.7→8.0"含 8.0 目标；"有效人力 2 人"=3人-1离职。按 TASKS.md 记等价命中（P usage 从 3/4 修正为 4/4）。
- **题面 key_facts 泄露教训（任务设计，已修复）**：T1 stage2 含"2周"、T4 含"自研/6周/采购"、T8 含"B"——key_facts 只在阶段 1 题面出现是 V2 硬约束（TASKS.md 4.2），重跑后 N 组全 0/4 证明修复生效。
