# dsh-brain-public
> 我给 LLM agent 加了一套"辩证注入 + 记忆插件"，跑了 100 条 trace，结论是：**没有系统性提升**。
这不是一个产品发布仓库，是一份**研究记录 + 可复现的评测脚手架**。如果你期待的是"装上就变聪明的 agent 插件"，这里没有；如果你想知道"结构化提示词 / 格式协议 / 多 agent 交接在 27B 上到底值不值"，这里有 100 条 trace 的实测数据。
## TL;DR
三阶段共 100 条 trace，测了三个不同测量面，得到同一个负结果：
| 阶段 | 测量面 | 结论 |
|---|---|---|
| V0（32 条） | 分析质量 | 辩证框架语义级 = 中性引导；格式级独有价值 = 矛盾命名 + 三件套 + issues 规则 |
| V1（50 条） | 行为维度 | adaptation / hypothesis / conflict_escalation 无变体差异；resistance 在单/双轮任务构造下不可测 |
| V2（18 条） | 协作成本 | 黑板协议传递完整（100%），但 P ≈ F（无超出信息传递的增益） |
完整结论 → [`docs/conclusions.md`](docs/conclusions.md)
## 为什么做这个
原始动机：把"辩证唯物主义的矛盾分析框架"注入 agent 提示词，让 agent 决策更结构化。进一步想把矛盾清单做成跨 agent 的格式协议（可审计 / 可 resume / 可折叠）。
需要验证的核心假设：**这种结构化注入，是优化还是拖后腿？**
## 做了什么
三个连续实验（每个都是独立预注册、独立跑批、独立判题）：
- **V0**：单 agent 静态单轮，4 组提示词（naive / naive+ / a 完整辩证 / b 最小引导）× 8 任务
- **V1**：单 agent 两轮，5 组（V0 四组 + f 强制套模板）× 10 任务，覆盖多轮动态 / 对抗误导 / 信息不全 / 冲突升级 / 资源危机 5 类
- **V2**：双 agent 跨 session 交接，3 组（P 黑板取回 / N 无信息 / F 直接给全文）× 6 任务
## 怎么测的
- 模型：Ternary-Bonsai-2-27B（本地 llama-server，temperature=0）
- 通道：b+ —— 模型输出 `memory_writes` JSON 声明块，脚本代调真实 `dsh-memory` 的 store / resume / search，避免"直连无工具环境"的评测缺口
- 判据纪律：预注册冻结 → 判定执行清单化 → 无变体差异先查任务 / 通道，不临场改判据
- 关键对照：V1 加 f 组（强制套模板，禁止 null）作为"教条化负对照"；V2 加 F 组（直接给全文）作为"上界"分离信息量与协议效应
方法论复盘 → [`docs/methodology.md`](docs/methodology.md)
## 结论
**辩证注入 / 格式协议对 agent 行为无系统性增益。** 三次不同测量面都测到同一个负结果。
价值收敛为工程便利：可审计（矛盾命名 + 三件套）、可 resume（issues 字段）、可折叠（事件流）。**不是**分析质量、行为质量、协作成本的提升。
完整叙事 → [`docs/conclusions.md`](docs/conclusions.md)
## 方法论复盘
这个项目最大的产出可能不是结论本身，而是"如何避免自欺"的评测纪律。踩过的坑都记在 [`docs/methodology.md`](docs/methodology.md)：
- **地板效应**：中性引导一句就能到天花板，辩证框架无从"额外增益"
- **判据执行漂移**：模型口头声明"保持原方案" ≠ 无实质调整——判据要对照预注册原文逐条核对
- **任务设计缺陷**：权威方向 = 合理方向时，resistance 判据无处落地
- **题面泄露 key_facts**：任务题面带结论 → 对照组虚高
- **通道缺口 ≠ 模型失败**：readback 只读 portable 时，remember 写入的 trace 判 fail 是通道缺陷
## 目录导航
```
packages/          参考实现（依赖第三方 @deepseek-ai/dsh，未包含在仓库内）
├── dsh-memory/            记忆存储（public 事件流 + portable 随身文档）
├── dsh-conduct/           提示词编排
├── dsh-brain-dispatch/    多 agent 调度（骨架）
├── dsh-brain-confinement/ 准入审计
└── dsh-brain-bundle/      打包预设
bench/multi-agent/  评测脚手架 + 全部 trace 证据
├── DESIGN.md              架构设计（三角 + 规则调度层）
├── STATE.md               三阶段进度与结论摘要
├── UNRESOLVED.md          待验证项
├── v0/  run.mjs + judge-*.mjs + prompt-*.md + TASKS.md + RESULTS.md + runs/（32 条）
├── v1/  run-v1.mjs + TASKS.md + BASELINE.md + RESULTS.md + runs/（50 条）
└── v2/  run-v2.mjs + TASKS.md + RESULTS.md + runs/（18 条）
docs/
├── conclusions.md         三阶段收敛结论
├── architecture.md        架构设计（从 DESIGN.md 提炼）
└── methodology.md         方法论复盘（判据纪律 / 预注册 / 清单化）
```
## 声明
- **第三方依赖未包含**：`packages/*/package.json` 引用了 `@deepseek-ai/dsh` 系列（`link:../../../dsh-monorepo/...`），这些源码**不在本仓库内**，仓库 clone 后不能直接 `pnpm install` 跑通——它是**研究记录 + 参考实现**，不是开箱可用的库。
- **模型第三方**：Ternary-Bonsai-2-27B 为第三方模型，本仓库不包含权重。
- **本机环境记录**：所有 trace 均在单机 llama-server 上跑出，脚本内的端口 / 路径 / 超时参数为本机适配值，迁移到其他环境需要调整。
- **凭证 / 敏感信息已清理**：仓库经多轮敏感词扫描与 git 入库检查，无凭证、无本机绝对路径、无第三方源码。
- **结论范围**：单模型、单/双轮任务族、b+ 通道；不推广到"辩证注入对所有模型/所有任务无用"，只陈述本项目实测范围内无系统性行为增益。
## 如何引用
如果你要在文章或项目里引用本项目结论，建议引用 `docs/conclusions.md` 的版本号与日期（当前 1.0 / 2026-10-02），并说明结论范围为"27B 单模型 + 单/双轮任务族"。
## 报告问题
如果你在仓库里发现残留的敏感信息或第三方源码片段，请开 issue（不要公开贴具体内容），或通过 GitHub 私信维护者。
