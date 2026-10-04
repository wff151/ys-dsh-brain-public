# dsh-memory v2 改进记录

> 版本 1.0（2026-10-02）。执行人：MainAgent（用户放权）。
> 优先级：短期记忆 > 长期记忆 > 用户画像。增量实现，全部可选字段，旧数据向后兼容。

## 一、动机

原记忆系统三处已知缺口（基于源码实读诊断）：

1. **短期记忆 = 消息副本**：`short` 表只存截断的消息文本（kind 无区分），防重做靠模型记忆，无"当前状态"概念，无任务上下文。检索评分 = weight × 关键词命中，权重只受时间衰减和重复写入影响。
2. **长期记忆自动记录是"截断不是提炼"**：title 取前 40 字符、去重按原始 title 全等比较——同前缀不同内容会被吞；无 task_id 关联，同一任务多次记录无法聚合。
3. **用户画像覆盖即丢失**：`setPermanent` 写路径无来源无时间戳，旧值覆盖后不可追溯；无自动提炼（写靠模型自觉）。

## 二、设计（短期记忆 v2 三层语义）

短期记忆从"消息副本"升级为三层，复用 `short` 表 + 可选字段：

| 层 | kind | 存储语义 | 用途 |
|---|---|---|---|
| 当前状态 | `state` | upsert，key → 当前值 + version 链（lastEventId） | 回答"现在是什么"（如豆存量、任务进度） |
| 变更事件 | `event` | append-only，带幂等键 + before/after + status | 回答"做过什么、能不能重做"，防重做 |
| 任务上下文 | `task` | upsert，goal / phase / pending / completed / blocked | 回答"接下来做什么" |

**防重做关键**：幂等键 = `taskId + action + target`（`idempotencyKeyOf`）。同键已有 success 事件 → 跳过（`withIdempotency` 包装）。区分动作型任务（查幂等键）与状态型任务（查当前状态是否已达成）。

**读取策略**：默认只给投影（`renderShortTermProjection`：当前任务 1 条 + 状态 3 条 + 最近事件 3 条），事实条目不进投影，由检索按需取回——防上下文膨胀（具身智能"状态投影"思想的借鉴，感知流不落地）。

**反馈回路**：`bumpShortRefCount` / `bumpPublicRefCount`——被引用条目提权（0.05/次，低于重复写入的 0.3，避免互相踩），配合时间衰减。

## 三、实现清单

| 文件 | 改动 |
|---|---|
| `src/domain.ts` | shortTermItemSchema 加 kind/entityKey/entityValue/idempotencyKey/eventStatus/phase/summary/relatedTask/refCount/lastEventId/ttlHours（全 optional）；publicMemorySchema 加 taskId/taskPhase/refCount；permanentProfileSchema 加 sources（来源+时间戳） |
| `src/types.ts` | 手写接口同步 v2 字段 |
| `src/store.ts` | 新增 upsertState / appendEvent / checkIdempotent / updateTaskContext / bumpShortRefCount / bumpPublicRefCount；recordPublicMemory 支持 taskId/taskPhase；setPermanent 记录 sources（覆盖保留最近 2 次旧值链）；writeShortTerm 加可选 kind；getPermanent 默认值补 sources |
| `src/state.ts`（新） | renderShortTermProjection（三层投影渲染）、withIdempotency（幂等执行包装）、idempotencyKeyOf |
| `src/autorecord.ts` | 长期标题改"首句提取"（≤40 字）；去重改归一化（去空白/标点/全半角）标题 + 内容长度差 <20% 才算重复（同标题不同内容不再被吞）；短期写入带 kind=fact |
| `src/context.ts` | renderMemoryContext 注入短期投影（预算内，事实不进） |
| `src/index.ts` | 导出 state.ts 三函数 |
| `tests/upgrade-test.mjs`（新） | 10 组 34 项断言 |

## 四、验证结果

- **新增套件**：`node --import tsx/esm tests/upgrade-test.mjs` → 34/34 通过
- **全量回归**：`tests/run-all.mjs` → 8 套件通过 / 0 失败 / 1 跳过（vector-test 需 embedding 服务，离线按设计跳过；与基线一致）
- **TypeScript**：`tsc -p tsconfig.json --noEmit` → 仅剩 3 个**基线已有**错误（index.ts:182 Schema<Config> 类型、tools.ts:24 REFLECTION_TEMPLATE 未使用、tools.ts:354 evolution type 字面量），经 git stash 验证 stash 前同样存在，非本次引入。本次改动零新增类型错误。

覆盖的 10 组断言：
1. 状态 upsert（同 key 覆盖/独立 key/版本链/提权）
2. 事件 append + 幂等（同键第二次 skipped）
3. withIdempotency 防重执行（第一次执行、第二次跳过）
4. 任务上下文（写入/投影文本/更新覆盖）
5. 短期投影渲染（任务/状态/事件/空投影返回空串）
6. 反馈回路（短期/长期 refCount 提升）
7. 长期 taskId 关联（写入 + 可检索）
8. 画像 sources（时间戳/旧值链/历史可找回）
9. autorecord 归一化去重（同内容去重、同标题不同内容不误吞、kind=fact）
10. 向后兼容（旧格式条目可读、不进投影）

## 五、遗留与说明

- **不修基线 3 个 typecheck 错误**：与本次任务无关，避免越界扩展；如需修复另行立项。
- **反馈回路未接入工具层**：bumpRefCount 的 store 方法已提供，`brain_memory_search` 命中后调用留待接入（工具层改动面大，本轮未动）。
- **LLM 提炼层未实现**：本轮为纯规则/确定性实现（测试不依赖 LLM）。"从记忆提炼方法论变技能"（带适用条件 + 失效边界）仍是最大能力缺口，建议下一轮做——用周期任务拉高频任务主题 → LLM 生成方法论草稿 → 存 evolution 的 rule 类型。
- **任务锚点自动召回未实现**：context 已注入任务上下文 + 状态投影，但"当前任务相关的长期记忆自动带出"（P0 建议项）尚未做——检索仍靠模型调 search。
- **版本说明**：domain version 保持 1，未加表（新增字段全 optional），storage-domain 无迁移负担。

## 六、文件同步

本记录随改动同步至公开仓库 `E:\ys-dsh\dsh-brain-public\packages\dsh-memory\`（原目录 `E:\ys-dsh\dsh-brain-plugins\packages\dsh-memory\` 为运行环境，两处源码哈希一致后同步）。
