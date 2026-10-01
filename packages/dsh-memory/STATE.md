# dsh-memory — STATE（状态入口）

压缩/换会话后先读本文件，再按需读 `src/` 对应模块。只写"到哪了、下一步、已知缺口"。

最近更新：2026-09-26。

## 已知缺口（移交记录，未修）

### M-001：resume 渲染不含小黑板 progress 正文（2026-09-26 由 cross-turn-task 实测发现并移交）

- **现象**：`resume.ts` 的 `renderResumeBrief` 只渲染 title/sessionId/goal/solvedProblems/unresolvedProblems/recentUserInputs（且过滤 `[小黑板更新]`），**不含 portable doc 的 progress 正文**。note 把关键信息写进 progress 时，Q2 用 resume 取不回。
- **实测证据**：cross-turn-task control-note（未修复写 goal 前）Q2 21 次 brain 调用、181.6s 超时、hitPort=false——resume 返回任务条目（"本地开发服务端口，第 1 次交换"）但不含 progress 里的端口；`search` 不检索 portable，模型死循环。把端口写进 goal 后 1 次 resume 调用即取回。
- **语义定性**：progress 是"干到哪了"，恰是 resume 最该给的信息；brief 已带 goal/unresolved，加 progress 摘要是语义自洽，不是扩权。判定为**遗漏**而非设计选择。
- **对诊断的影响（跨轮任务侧）**：模型自发 `note`（写 portable）→ resume 渲染缺口 → Q2 取不回 → 被误判为"模型没自发记"（假阴）。**"写侧行为不稳定"与"渲染缺口"在数据上分不开**，除非 A/B 中命中 resume 缺口的 run 单独标注。
- **修复待定决策（memory 插件自己定，跨轮任务无权替定）**：
  1. progress 正文渲染多少字（截断规则）？
  2. 最近 N 条？按时间取还是全量？
  3. 是否新增独立读取口（如 action=read_note）替代改 brief？
  4. 是否影响 `resume-test.mjs` 既有断言。
- **修复方案（2026-09-27 定稿并已实施）**：**全量渲染 + 单条截断 120 字 + cap 20（超上限取尾部）**。字段名 **`progressEntries`**。渲染位置：目标 → 已解决 → 待解决 → **最近进展** → 最近在做。`renderResumeBrief` 增量加行，既有断言不受影响。
  - 依据：progress 是 **append-only**（`store.ts:350` `appendUnique` 追加去重）——N=3 截尾部会漏早期关键决定（第 1 次 note 写端口、后 5 次写杂事时 N=3 正好漏端口）；portable 是会话级且 note 描述自带"简单一步任务不必用"引导，条数天然受控，全量可接受。
  - **状态**：已修复（2026-09-27），`resume-test.mjs` 新增 [5b]/[6b] 断言（空串过滤→cap 截尾、默认 20 全量、单条截断、仅 1 条下限、空 progress），全量 7 套件通过。
  - **状态分层（2026-09-27）**：**静态验证通过**（resume-test 40 断言 [5b]/[6b] 覆盖空串过滤→cap 截尾/默认 20 全量/单条截断/仅 1 条下限/空 progress + dist 内嵌确认）；**运行时已验证（2026-09-27 PASS，guided --m001 n=2）**：runner 加 --m001（B 组引导 + progress 追加句），两轮 Q1 note 均含 progress 字段（dump 直接证据）；Q2 run1 单次 resume 直取端口/代号、run2 search×9 失败后 resume 成功——resume 渲染路径真实生效。**判定依据（2026-09-27 修正）**：M-001 生效的直接证据 = **Q1 写入了非空 progress 字段（run1/run2 dump 均证）+ Q2 取回成功**——渲染路径已触发即成立；端口来自哪个字段（progress vs goal/issues）的归因**不必要**，因为三字段都可能携带端口，真正的假阳是"progress 为空但端口经 goal 取回"，该路径已被非空证据排除。跨轮实验 3 run 的 note 均只写 goal+issues（引导未要求 progress）→ progressEntries 空 → resume 不渲染"最近进展"（行为正确）。**触发条件：Q1 的 note 明确写 progress 字段**（如 control-note 变体加 progress 要求，或真实场景模型自发写 progress）。
  - **实施教训（重要）**：dsh 通过 `dsh-brain-bundle/dist/*.mjs` 加载 memory（`cordis.patch.yml` name=`./dist/memory.mjs`），**改 memory 源码后必须重建 bundle dist**（`packages/dsh-brain-bundle` 下 `node scripts/build.mjs`）才生效；跨轮首轮实验曾跑在 9-26 旧 dist 上，重建（9-27 12:39）后重跑。
  - **观察点（不改方案，记档）**：全量 brief 可能过长、关键决定被中间状态稀释 → 若实际运行中频繁撞 cap 20，那是 note 被滥用/progress 当流水账的信号（note 描述引导理论上自然受控）；将来可考虑分层（关键 vs 一般条目）。cap 20 是防极端，不是目标值。
- **修复前缓解（cross-turn 侧）**：A/B run 里 note 走 goal 字段；命中 resume 缺口的 run 单独标注。

### M-002：search 是否应覆盖 portable（note 写入处）（2026-09-27 定性：**设计如此，不是 bug**）

- **现象**：`retrieval.ts` 的 search 只检索 long + short，**不检索 portable**（note 写入的会话级小黑板）。模型自发 `note`（goal 完整含端口）后，main-Q2 默认 search 取不回，**必须模型自发想到用 resume** 才能取回（实测：B 组 run2 43 次全 search 超时 ✗；run3 17 search + 5 resume 取回 ✓）。
- **定性（2026-09-27 拍板）**：**设计如此，不是 bug**。三条判断线：
  1. **语义分工**：search → public/short（跨会话可召回的"知识"）；resume → portable（本会话小黑板，跨会话取回是"接着上次干"）。note/remember 用途本就不同：note 记"我这次干到哪"，remember 记"这条知识以后有用"。
  2. **模型该知道分工**：设计如此 → M-003 是**必修**（工具描述必须让模型知道"note 的东西要用 resume 取"）。
  3. **用户会怎么问**："我们上次定的端口是多少"= 接着干（resume）；"项目部署规范是什么"= 查知识（search）。让模型自动选对靠的是工具描述（语义分类），不是 search 覆盖面。
- **取向记录（无对错，只有取向）**：本定性偏"工具粒度"——把 portable 塞进 search 会让"本会话中间状态"（"我刚改了 x 文件的 y 行"）变成全局可召回噪声，污染长期知识库；note/remember 分层正是为避免该污染。代价是模型必须学会工具分工（M-003 配套义务）。若将来倾向"模型友好"（一个 search 全搞定），可翻案为 bug，代价是召回噪声上升。
- **影响**：跨轮任务 q2-hinted 实验按"设计如此"分支设计（对象=工具语义自描述，非 prompt 措辞）。

### M-003：brain 工具描述未讲清"note 写本会话、跨会话用 resume"（2026-09-27 定性：**必修**，配套 M-002）

- **现象**：`tools.ts` buildMemoryCapabilities 里各 action 的描述文本，未向模型说明"note 写入的是**本会话**（portable），**跨会话取回要用 resume**；search 检索的是 long+short 公共记忆"。B 组 run2 的模型在 Q2 反复 search 而不试 resume（run3 才自发试到），部分原因是工具描述没教这个映射。
- **定性**：M-002 定为"设计如此" → M-003 是**必修**（不是可选的文档改进）：工具描述必须让模型读到两类问题 → 两类工具的映射。即使将来 M-002 翻案为 bug（search 覆盖 portable），M-003 仍值得做（模型理解工具分工本身有价值）。
- **修复待定**：描述文本具体措辞、放 action 描述还是工具总描述；改后跑 memory 插件自身测试确认无回归。
- **修复方案（2026-09-27 用户审查后定稿，见下方 before/after）**：
  - **after A 首版**（最小补映射）；**after B 留档**为跨轮任务硬约束 3 的备用（描述不够醒目时再上）。
  - **before 原文（M-003 修复前，tools.ts 现 menu）**：
    - note：`更新随身小黑板：目的 / 进展 / 问题 / 结果 / 下一步。开工定目标、阶段进展、卡住、收尾时用；简单一步任务不必用，不要每轮调用。`
    - search：`检索长期记忆里的过往经验 / 偏好 / 结论。需要跨会话经验、面临关键或不可逆决定、或怀疑以前踩过同样的坑时用；简单直接的任务不要用。`
    - resume：`断点续跑：只读查看其它历史会话里没收尾的任务（目标 / 已解决 / 待解决 / 最近进展）。换会话接着干时用；接续前先与用户确认，不自动重放。`
  - **after 原文（2026-09-27 已修复并回填，tools.ts 现 menu）**：
    - note：`更新随身小黑板：目的 / 进展 / 问题 / 结果 / 下一步。开工定目标、阶段进展、卡住、收尾时用；简单一步任务不必用，不要每轮调用。小黑板是本会话内的；换会话后要取回，用 resume。`
    - search：`检索长期与短期记忆里的过往经验 / 偏好 / 结论。需要跨会话经验、面临关键或不可逆决定、或怀疑以前踩过同样的坑时用；简单直接的任务不要用。本会话小黑板内容（note 写的）不在此列，用 resume 取。`
    - resume：`断点续跑：只读查看其它历史会话里没收尾的任务（目标 / 已解决 / 待解决 / 最近进展）。换会话接着干时用；接续前先与用户确认，不自动重放。上一会话用 note 记的小黑板内容也在这里取回。`
  - **状态**：已修复（2026-09-27），`tests/run-all.mjs` 7 套件通过（vector 离线跳过，既有行为）。B 版（显眼版）留档于 cross-turn-task/DESIGN.md 硬约束 3。
- **修复验收要求（2026-09-27 跨轮任务侧约束）**：
  1. **before / after 的 brain 工具 description 原文都留档到本文件**（M-003 条目下或附件）；修复用**独立 commit message** 标注"M-003 修复内容"。否则跨轮实验无法把结果归因于描述措辞。
  2. 修复后先跑 `tests/` 回归，再通知跨轮任务线开跑工具描述条件实验（DESIGN.md 三条硬约束见 cross-turn-task/DESIGN.md）。

## 到哪了
- 见 `src/` 各模块与 `tests/run-all.mjs`；本轮未改任何源码（M-001/M-002/M-003 仅定性/移交记录，未修）。
- **已定决策**：M-002 = 设计如此（不是 bug，取向=工具粒度）；M-003 = 必修（配套 M-002）。跨轮任务 q2-hinted 实验按"设计如此"分支设计。
- **下一步（memory 侧）**：修 M-001（resume 渲染缺 progress）→ 修 M-003（工具描述补 note→resume 映射）→ 各自跑 `tests/` 确认无回归。
