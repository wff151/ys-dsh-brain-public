# V0 运行结果 — 单 agent 辩证法提示词验证（通道 b+）

日期：2026-09-30。模型：ternary-bonsai-2-27b（本地 llama-server :8081，--temp 0.7 服务端，请求覆盖 temperature=0）。
通道：b+（模型输出 memory_writes 声明块 → v0-bridge 真实 store 写入 → 真实 resume 渲染读回）。

## 〇、实验组（四组，32 trace）

| 组 | 提示词 | 说明 | trace |
|---|---|---|---|
| a | prompt-a.md | 完整结构化（三层 rubric + 负禁则 + 黑板规则） | 8 |
| b | prompt-b.md | 最小引导（无 rubric 无负禁则，方向引导 + 黑板规则） | 8 |
| naive | naive-prompt.md | 无辩证引导基线（"请分析任务并说明处理方式"） | 8 |
| **naive+** | naive-prompt-plus.md | **naive + 一句中性指令"请分析这个任务的主要问题是什么"**（隔离格式效应，用户复核第二轮补跑） | 8 |

naive 组为用户复核第一轮补跑；naive+ 组为用户复核第二轮补跑（隔离"100% vs 0%"中未隔离的变量）。

## 一、运行参数（实现适配记录）

| 项 | 值 | 说明 |
|---|---|---|
| temperature | 0 | 冻结 |
| max_tokens | a/b：8192×15 + a-T7 <elided>；naive/naive+：16384×16 | a-T7 截断证据：finish_reason=length, completion_tokens=8192（必要适配） |
| 任务 | T1-T8 × 4 组 = 32 | TASKS.md 冻结集 |
| 数据隔离 | .test-data/v0-memory 每批清空重建 | 每条 trace 独立 sessionId |

## 二、运行中修复（如实记录）

1. run.mjs 全量单变体 bug → 修复循环 + `--variant` 显式指定（naive/naive+ 入口）。
2. extractJsonBlock 两处缺陷（围栏-only、lastIndexOf 最内层）→ 修复。b-T3/b-T8 是模型 JSON 语法错误（缺 ]/未转义引号），按 VERDICT §7 判 fail 不重试。
3. 空话初筛误判率高（7/7 误判）→ 人工复核全改 concrete（具体内容未被初筛模式覆盖）。
4. naive/naive+ 组 remember 写入 readback found=false → **通道缺口**（readResume 只读 portable），非模型失败 → judge-public-readback.mjs 重放验证 8/8 命中（naive 4 + naive+ 4）。

## 三、四组判定（标注者 A = 主代理；**单标注，未校准**，标注者 B 待用户复核）

| 组 | 格式级 primary_clear（"主要矛盾=X"字样） | 语义级 contradiction（显式冲突/取舍结构） | 黑板读回 | 空话 |
|---|---|---|---|---|
| a | 8/8 (100%) | 8/8 (100%) | 8/8 | 0 |
| b | 8/8 (100%) | 8/8 (100%) | 6/8（格式 fail 2 条） | 0 |
| naive | 0/8 (0%) | 4/8 (50%) | 8/8 | 0 |
| naive+ | 0/8 (0%) | **8/8 (100%)** | 8/8 | 0 |

**双判据拆分**（用户复核核心要求）：
- **格式级**：a/b 100% vs naive/naive+ 0%——只测出"是否被要求按'主要矛盾 = X'格式写"。
- **语义级**：a/b 100% = naive+ 100%，naive 50%。**一句中性指令"主要问题是什么"就把语义识别从 50% 提到 100%，与辩证框架持平。**

## 四、核心结论：V0 的显式化效应 = 格式指令效应（格式效应实锤）

用户复核怀疑的未隔离变量已实证：

1. **naive 0/8 是"没被要求"，不是"没识别出"**（解释 B 成立）。naive+ 加一句中性指令后 8/8 写出显式矛盾结构（"主要问题不是 X，而是 Y"句式：T1"时间约束与完整实现目标冲突"、T3"短期止血与长期根治之间的平衡"、T6"短期/局部收益与长期一致性之间的权衡"……），质量不亚于 a/b 的"主要矛盾 = X"。
2. **辩证框架（a/b）与中性指令（naive+）在语义级显式化上完全等价**（均 8/8）。三层 rubric、负禁则、转化条件三件套模板**未带来语义级额外增益**。
3. naive 的 4 条隐含识别（T1/T3/T4/T6：行为由冲突驱动但无显式冲突词）证明模型分析中本就处理矛盾，只是不显式命名。

**V0 能说的**：
- 辩证提示词改变**输出格式**（"主要矛盾 = X"命名 + 三件套结构 + 黑板写 issues 规则）——**格式/组织价值**（可审计、可结构化）。
- 黑板写读闭环成立（30/30 可读回，与提示词无关；b 组 2 条格式 fail 非存储问题）。
- 三组均无空话（任务集上模型本就不说空话）。

**V0 不能说的**：
- ~~辩证注入提升分析能力/质量~~ —— 语义级识别 a/b = naive+，模型本来就能识别，缺的是显式化要求。
- ~~a（结构化模板）优于 b~~ —— 无差异（格式级都 100%、语义级都 100%）。
- ~~空话抑制有效~~ —— 任务集无区分度（全 0）。

## 五、通道效应（两条，已标注）

1. **b-T3/b-T8 是格式跟随差异，非分析差异**（a 模板间接提升 JSON 格式跟随）。
2. **工具选择暗示**：a/b 提示词含"用 brain 工具 note（或 remember）"→ a/b 14/14 选 note；naive 4/8 note、naive+ 4/8 note。**提示词引导工具选择，V1 黑板规则需注意此耦合**。

## 六、通道缺口（已实证，定论）

- V0-bridge readResume 只读 portable；remember 写入的 trace readback found=false 是通道缺陷非模型失败。
- 重放验证（judge-public-readback.mjs：独立 store 重写 + listAllPublicMemories 按 issues 匹配）8/8 命中。
- **结论已移入 UNRESOLVED 已验证项**：b+ 通道 readback 必须同时读 portable（resume）与 public（search/listAllPublicMemories）。

## 七、局限与待办

1. **单标注 → 两轮一致性检验（路 A，2026-09-30 完成）**：
   - **第一轮（半盲）**：8 条覆盖四组 + 边界案例，材料带案例标签（构成判定倾向暗示）→ A/B 三列 8/8 一致，κ=1.0。
   - **第二轮（全盲）**：另选 B 未看过的 8 条、无标签材料（`calibration/calibration-material-blind.md`）→ A/B 三列 8/8 一致，κ=1.0（primary_clear Pe=0.5、contradiction Pe=0.781）。
   - **方法学限制（标注者 B 提出，成立，必须保留）**：两轮 κ=1.0 **不是判据清晰度的充分证据**——判据回顾里的枚举（"不是X而是Y""A但B"等）构成口径训练，B 在已形成的口径下判，第二轮虽无标签但判据本身已含枚举。真正的判据清晰度盲测 = 判据只给抽象定义（"是否显式冲突"）、不给枚举，再看一致率。**该测试推迟到 V1 双标注预校准执行**（见 v1/TASKS-DESIGN.md 执行顺序第 3 步改进）。
   - **结论**：V0 判定一致性 = 两轮 8/8（κ=1.0），但**置信度限于"在枚举口径下的判题一致性"，非判据本身清晰度**。
2. **n=1 批次**：每任务 1 trace × 4 组。方向性结论。
3. **任务集过简单**：空话维度无区分度（全 0）；静态单轮矛盾识别维度已到天花板（naive+ 8/8 证明引导即可显式化）。
4. **max_tokens 参数差异**：a/b 组 8192（a-T7 16384）、naive/naive+ 组 16384。已记录，不影响判定。
5. **b-T3/b-T8 判 fail**（通道效应，接受）。

## 八、V0 最终定位：分层结果（用户复核精确化）

**残留变量澄清**：naive+ 的措辞"请分析这个任务的主要问题是什么"本身是**引导**（中性措辞，但引导模型去找一个主要问题）。V0 测出的等价是**"辩证框架 vs 中性引导"**在语义级显式化上等价；**"辩证框架 vs 无引导"**未测（naive 真无引导 50% < 100%，证明"有没有引导"有差别）。

**三层结论**：

| 层 | 语义级矛盾识别 | 格式级（主要矛盾=X） |
|---|---|---|
| 无引导（naive） | 50% | 0% |
| 中性引导（naive+） | 100% | 0% |
| 辩证引导（a/b） | 100% | 100%（+三件套+issues规则） |

**辩证框架的价值不是零，是被压缩到格式层**。格式层是否有价值取决于下游：若 V1 多 agent 需要**可审计、可折叠、可 resume 的矛盾清单**（黑板事件流 + 折叠函数 + resume 读回），格式层就是**协作协议**，不是"分析能力"——这是 V1 设计中格式层要承担的角色。

**对项目价值的含义（分层表述）**：
- 辩证注入的实测价值 = **引导效应（语义显式化，与中性引导等价）+ 格式协议（矛盾命名、三件套、issues 写入规则，独有）**
- 分析能力增强无证据（模型本来就能识别矛盾，引导即可显式化）
- **V1 检验点 = 行为维度**（adaptation/resistance/hypothesis）+ **格式层的协作价值**（多 agent 场景下矛盾清单的可审计/可折叠/可 resume）

## 九、复现

```
# 模型（用户 bat）：start_ternary-bonsai-2-27b-64k-q8 - 副本.bat
cd packages/..
node --import tsx/esm bench/multi-agent/v0\run.mjs                     # a+b 16
node --import tsx/esm bench/multi-agent/v0\run.mjs --variant naive      # naive 8
node --import tsx/esm bench/multi-agent/v0\run.mjs --variant naiveplus  # naive+ 8
node bench/multi-agent/v0\judge-apply.mjs          # a/b 判定
node --import tsx/esm bench/multi-agent/v0\judge-public-readback.mjs naive T1 T2 T4 T5
node --import tsx/esm bench/multi-agent/v0\judge-public-readback.mjs naiveplus T2 T3 T4 T6
node bench/multi-agent/v0\judge-naive-verdict.mjs  # naive 判定
node bench/multi-agent/v0\judge-semantic.mjs       # 语义级初筛（人工复核兜底）
node bench/multi-agent/v0\judge-final.mjs          # 32 条最终判定
```
