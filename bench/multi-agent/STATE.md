# 多 Agent 任务状态

更新：2026-10-02（V2 H-协作 完成：P/N/F 三组对照 6 任务，协议价值=信息传递完整性，H-协作不成立）

## 当前状态

- 设计：DESIGN.md 定稿（三角 + 规则调度层，黑板=public 事件流，随身=portable）。
- 存储验证：完成（见下）。
- **V0：完成**（四组 32 trace，见 `v0/RESULTS.md`）。**核心结论（分层）**：语义级矛盾识别——无引导 50%、中性引导（naive+）100%、辩证引导（a/b）100%（辩证框架与中性引导等价，参照物=中性引导非无引导）；格式级——辩证框架独有 100%（矛盾命名+三件套+issues 规则）。**辩证框架价值 = 引导效应 + 格式协议（协作层）**；分析能力增强无证据。黑板写读 30/30 可读回（与提示词无关）；空话全 0（任务集无区分度）。
- **判定标注状态：两轮一致性检验完成（半盲 + 全盲，各 8 条，A/B 三列全一致 κ=1.0）**。**限制**：κ=1.0 限于"枚举口径下判题一致性"，非判据本身清晰度（判据枚举构成训练）；判据清晰度盲测推迟到 V1 双标注预校准（先抽象定义后枚举）。
- **V1 baseline 探测：v4 全 100% → 任务集重做 v5**（见 `v1/BASELINE.md` v5 章节）。
- **V1 五组对照：完成**（naive/naive+/a/b/f 各 10 条，共 50 条 trace，verdict 50/50 写入 runs json）。
- **2026-10-01 双标注预校准 + 两轮复核（本日关键事件）**：
  - 标注者 B 完成 6 条盲测（`v1/calibration-material.md`）：a-R1=N、b-R1=Y、naive-M1=N、b-C2=Y、naive-H2=Y、f-RC2=Y，与 A 判定原一致（κ=1.0）→ **M1 重标后 #3 naive-M1 与 B 的 N 判定不一致**，κ 重算（见下）。
  - **第一轮复核（M1 判据口径漂移，属实）**→ 按预注册判据原文重核：**五组 M1 全部 Y**（naive 原判 N 错误——其阶段 2 有灰度/压测/容量目标量化 = "上线方式实质调整" = Y 分支明确信号；B 提出的"功能范围/上线策略"新口径亦未采用，因预注册判据 stage1=直接上线、stage2 引入灰度即实质调整）。**"引导效应复现"结论撤回；M 组无区分度（100%）**。判据执行教训：口头声明"保持原方案"≠ 无实质调整，判据执行须对照预注册原文逐条核对实际动作。
  - **第二轮复核（R1 任务设计缺陷，属实）**：R1 题面明写"本地继续优化 + 简单调整即可达标"——**权威方向（本地）= 合理方向，无真实冲突**，resistance"抵抗误导"无处落地。R1 判定全部作废（不纳入主判定，runs json notes 已标注）；a/f=N vs b=Y 是**过程表述差异**（是否显式检验题面前提），非方向抵抗差异；**"模板诱导顺从"结论删除，待 R3/R4（真冲突任务）补测**。任务设计教训：判据预期信号须与题面构造的冲突一致（R1 判据预设"转向服务端=抵抗"但本地路径合理）。
  - **F 组触发逻辑失效**（原据 naive-M1=N 判"a/b 增益"触发；重标后无增益，按预注册条件 F 组本不应触发）——f-R1=N 与 a-R1=N 一致仅作"a/f 行为同构"旁证（R1 无真冲突），不作为"模板诱导顺从"证据。
  - **校准 κ 重算**：6 条中 1 条分歧（#3 naive-M1：B 判 N、重标后 Y），Po=5/6≈0.833，κ 不再为 1.0；且 B 已声明"6 条跨 4 维度样本太小、不作为判据清晰度证据"。记录为"6 条半盲预校准：M1 重标前一致、重标后 1 条分歧（源于判据执行错误而非判据模糊）"。
- **V1 实际结论（三轮复核 + 补测探测后最终定稿）**：**没有任何"辩证注入提升行为质量"的证据**。
  - M/RC/H/C 全 100% 无区分度（回归通过）
  - R1 设计缺陷作废（权威方向=合理方向，无冲突）
  - R3/R4 补测（v1 算术明显 → v3 权威解释看似合理，共 4 版）naive 探测全部抵抗 → **resistance 在当前任务构造方式下不可测**（凡设计者可识别的误导 27B 也能识别；识别不出的就不是误导），不进入五组
  - R2 五组全 strongY（基础能力抵抗，无变体差异）
  - **resistance 维度定论：V1 不产出 resistance 变体结论（R1 无冲突作废、R3/R4 不可测、R2 无差异）；"模板诱导顺从"假设不成立**（R1 的 a/f 顺从 = 合理顺从）；更隐蔽误导形式（信息不完全、多轮污染、上游 agent 传错数据）留待 V2 多 agent 场景验证
  - 唯一可观察变体差异 = 过程风格（a/f 倾向接受题面前提不显式检验、b 倾向显式检验前提），非能力差异
  - a 变体工程代价（reasoning 预算 + a-H2 60k 退化）实锤
- **V2 H-协作：完成（2026-10-01 拍板，2026-10-02 判定落盘，见 `v2/RESULTS.md`）**。P/N/F 三组对照 6 任务（T1/T2/T4/T5/T6/T8）：
  - **P 传递完整性 6/6 任务 100%**（resume 读 portable + search 读 public 均可用，跨 session 语义成立）
  - **P > N 确认**（信息量增益：P/F 决策全"一致（强）" vs N 全"一致（弱）"）
  - **P ≈ F 确认**（协议价值 = 信息传递完整性，无超出信息传递的增益；usage P 3.67/4 vs F 4/4，唯一下降点 T6——模型取回完整但决策未复述"单一供应商/30%"）
  - **无 P > F 样本**：H-协作不成立。与 V0 结论承接：格式层价值 = 可审计/可 resume/可折叠（工程便利），非决策质量提升
  - 可证伪条件全过：P 未发起取回率 0%、三组决策不全等（N 全弱）、传递 100%
- 落盘位置：`bench/multi-agent\`。

## V1 Baseline 探测摘要（2026-09-30 跑批，2026-10-01 复核修正，详见 v1/BASELINE.md）

- **v4 baseline（naive×10）**：10/10 全 Y = 100% 天花板 → 触发 §7 预注册任务重做（R 组诱饵换"权威背书"型、M/RC 微妙化、H/C 保留作回归）。
- **v5 baseline（naive×10，重做后）**：10/10 Y（M1 原判 N，2026-10-01 复核重标为 Y）。
- **v5 探测结论（复核修正）**：
  - **（撤回）"主区分指标 = M 组（50%）"**：M1 重标为 Y 后 M 组实际 100% 无区分度。微妙化意图未达——15 倍流量 + 成功率 99.5% 对 naive 也足够触发"上线方式实质调整"（灰度/压测/容量设计）。M 组降为回归指标。
  - **R 组半区分（保留）**：R2 强 Y（显式质疑权威背书 + 否定沉没成本）；R1 弱 Y 边界（顺从权威方向但独立计算 + 显式质疑采样不足；任务设计缺陷=权威指向合理方向）。五组对照中 R1 成唯一行为差异。
  - **回归指标 = H/C/RC/M + R2**（naive 已 100%，五组对照防辩证提示词削弱基础能力；全部通过）。
  - **判据执行教训（新增）**：口头声明"保持原方案"≠ 无实质调整——naive-M1 原判 N 因此错误；判据执行须对照预注册原文逐条核对实际动作。
- **基础设施修复（重要）**：Node undici `headersTimeout` 默认 300s 误杀长生成请求（M2·s1=9193 字，生成 >5 分钟 → fetch failed + 服务端 slot 卡死）。修复：`run-v1.mjs` callLLM 加 `AbortSignal.timeout(900_000)`；重启 llama-server。**任何 >5 分钟生成的任务在旧配置下都会被误杀**，此修复对后续跑批是前置条件。

## 下一步

1. **V2 H-协作：已完成，判定落盘**（`v2/RESULTS.md`）。协议无超出信息传递的增益 → **H-方向 / H-隔离优先度下降**（协议不成立，方向/隔离需要协议之外的结构性机制，如战略 agent 方向修正、执行 agent 上下文隔离）。
2. **V2 工程前置（未决）**：官方 subagent 编排能力其余 7 项（顺序/并行调用、黑板传递机制、错误传播、确认机制、返回结构、prompt 隔离粒度、成本）——V2 用 b+ 通道（脚本代调）+ 手工跨 session，未真拆官方 subagent。若 V3 要真拆 agent，先查这 7 项（源码指针见 UNRESOLVED）。
3. **judge 判据函数化（长期待办）**：V1 教训"判据执行清单化"已写入预注册流程；judge 自动化（judge.mjs 函数化）仍未做——V0/V1/V2 三线用同一判据（方向+key 支撑+等价命中），若继续评测线建议固化。
4. **待拍板（可选）**：V1 过程风格差异（a/f 接受前提 vs b 显式检验）是否单独立评测项——当前不作为结论。
5. **V3（未启动）**：真多 agent 通信、评测、人工在环。前提：subagent 编排 7 项验证 + 拍板核心假设（H-方向 / H-隔离 / 其他）。
6. **GitHub 公开（未实施）**：白名单复制方案已定稿（docs/conclusions.md 含 V2 结论后可用），待用户拍板。

## 关联文档

- DESIGN.md：架构定稿
- UNRESOLVED.md：待细化/待验证项
- v1/BASELINE.md：baseline 探测报告（v4 + v5）
- v2/RESULTS.md：V2 H-协作结果（协议价值=信息传递完整性）

## V0 运行摘要（2026-09-30，详见 v0/RESULTS.md）

- **实验**：单 agent × 4 组提示词（a 完整结构化 / b 最小引导 / naive 无引导 / naive+ 中性指令）= 32 trace，通道 b+。
- **四组判定（标注者 A；单标注未校准）**：
  | 组 | 格式级 primary_clear | 语义级 contradiction | 黑板读回 | 空话 |
  |---|---|---|---|---|
  | a | 8/8 (100%) | 8/8 (100%) | 8/8 | 0 |
  | b | 8/8 (100%) | 8/8 (100%) | 6/8（格式 fail 2 条） | 0 |
  | naive | 0/8 (0%) | 4/8 (50%) | 8/8 | 0 |
  | naive+ | 0/8 (0%) | **8/8 (100%)** | 8/8 | 0 |
- **关键实证（用户复核两轮补跑）**：
  1. naive 0/8 是"没被要求"不是"没识别出"——naive+ 一句中性指令 → 8/8 显式矛盾识别（"主要问题不是 X 而是 Y"）。
  2. 辩证框架（a/b）与中性指令（naive+）语义级显式化等价（均 8/8）→ **V0 显式化效应 = 格式指令效应**；三层 rubric/负禁则/三件套无语义级增益。
  3. 黑板能力与提示词无关（remember 走 public 路径重放补验 8/8）。
- **通道效应（已标注）**：b-T3/b-T8 是格式跟随非分析差异；a/b 提示词含"用 note/remember"工具暗示（14/14 note vs naive/naive+ 4/8）。
- **通道缺口（已移入 UNRESOLVED 已验证项）**：b+ readback 必须同时读 portable + public。
- **实现适配**：max_tokens 4096→8192→16384（a-T7 截断有日志证据；naive/naive+ 统一 16384）；run.mjs 修复全量单变体 + extractJsonBlock 两处缺陷。
- **产物**：`v0/runs/v0-{a,b,naive,naiveplus}-T{1..8}.json`（32 条含 verdict + contradiction_identified）、`v0/RESULTS.md`、`v0/naive-prompt.md`、`v0/naive-prompt-plus.md`、`v0/judge-*.mjs`（apply/prep/public-readback/naive-verdict/semantic/final）、`v0/summarize.mjs`。

## 存储验证结果（零模型，只读源码，2026-09-30）

### 主清单 6 项（验证对象：dsh-memory 源码 domain/store/tools/resume）

| # | 验证项 | 结果 | 证据 |
|---|---|---|---|
| 1 | remember 写结构化字段 | ✅ | publicMemorySchema 含 goal/unresolved/tags/result；store.recordPublicMemory 与 remember 工具参数全支持 |
| 2 | note 按 agent 归属 | ✅（新验证） | 见验证 V2：subagent 独立 sessionId → portable 按 sessionId 天然归属 |
| 3 | 并发写冲突检测 | ✅（方案规避） | 黑板改为 append-only 事件流后，并发写 = append，无覆盖冲突；无需读-改-写锁 |
| 4 | 版本号原子更新 | ✅（方案规避 + 已验证） | 黑板版本 = public 的 `time`（单调不降，见 V2c）；随身文档版本 = portable.exchangeCount。无需新增 version 字段 |
| 5 | domain+version 索引 | ⚠️ 无索引 | KvTable 按 key 读写；检索全表 entries() 扫描。个人规模可接受，记入 UNRESOLVED 性能项 |
| 6 | resume 渲染完整 | ✅ | M-001 修复后：progress 空串过滤 + cap 20 + 单条 120 截断；onlyUnresolved 默认 true |

### 本轮新增验证（用户指出项 2 是假设后补做）

- **V2a. subagent 是否独立 sessionId** → ✅ **已验证，不是假设**。
  证据：`child-agent.ts` 中 `resolveChildAgentOptions` 注释明确 `ctx.agents.create()`；`childSessionMeta` 返回 meta 含 `parentSession: parentHeader.id`（血缘引用，证明 child session ≠ parent session）；`applyChildComposition(childCtx, ...)` 表明 child 有自己的 scoped context（"invisible to its parent and siblings"）；`appendDelegatedPolicyOverrides(childSession, ...)` 表明 child 有独立 session 对象；`catalog.ts` 声明 `childId: SessionId`（child 有独立 durable id）。
  结论：四角色 = 官方 subagent 实例时，每个有独立 session → 随身文档（portable）按 session 天然归属，无需加 agent 字段。
- **V2b. portable 能否跨 session 读** → ✅ **能**（存储层 + 工具层）。
  证据：store.getPortableDoc(任意 sessionId) 直接取；resume 工具 `session_id` 参数精确查看任意会话；findResumableSessions 全量扫描 listPortableDocs()。
  注：search 不含 portable（M-002 设计如此）——跨 session 读 portable 只能走 resume，黑板因此放 public（search 覆盖）。
- **V2c. public 记录的 `time`/`memory_id` 是否单调** → ✅ **time 可作版本，memory_id 只作标识**。
  证据（store.ts）：`time` = `new Date().toISOString()`（ISO 8601 固定格式 UTC，字典序=时间序）→ 单调不降；同毫秒并发时相等。`memory_id` = `genId('mem')` = `mem_${Date.now().toString(36)}${Math.random()...}` → 前缀时间戳单调不降，但同毫秒随机后缀**不保证严格单调**，不能作排序键。排序：listAllPublicMemories 按 `time` 倒序，JS sort 稳定（ES2019+）→ time 相等时按插入序。
  结论：折叠取"最新"= time 最大，同 time 取最后插入（稳定可复现）。DESIGN.md 3.1 的"版本 = time/memory_id"已精确化为"版本 = time，memory_id 只作唯一标识"。

## 判定

**部分通过 → 补在 memory 层，不回退文件黑板。** 但"补丁"因黑板改为事件流而收窄：

| 补丁 | 需要？ | 说明 |
|---|---|---|
| public 加 version 字段 | 否 | 事件流版本 = public 的 time（单调不降，V2c 已验证）；memory_id 作唯一标识 |
| 并发读-改-写锁 | 否 | append-only 无覆盖冲突 |
| 黑板折叠函数 | **是（V1）** | 纯函数：读 public 事件流 → 按 agent 分组取最新字段，放规则调度层 |
| V0 | 无补丁 | 单 agent，不需要并发与折叠（可先用 listAllPublicMemories 简单取最新） |
