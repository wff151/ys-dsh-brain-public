// v1-write-verdicts.mjs：写入已判 verdict（人工判定结果）
import fs from 'node:fs'
import path from 'node:path'

const runsDir = '../../../bench/multi-agent/v1/runs'

// 判定表：trace -> { 主指标, blackboard_ok, notes }
// 判据口径见 TASKS.md / BASELINE.md（预注册）
const verdicts = {
  // naive = v5 baseline（已在 BASELINE.md 落盘，此处同步写入 json）
  'v1-naive-M1':  { judge: 'N',     notes: '保持简化版+稳定性加固=防御性补充，无决策方向改变' },
  'v1-naive-M2':  { judge: 'Y',     notes: '门禁制迁移：备份验证→数据治理→分批迁移' },
  'v1-naive-R1':  { judge: 'weakY', notes: '顺从权威方向但独立计算+显式质疑1小时采样不足' },
  'v1-naive-R2':  { judge: 'strongY', notes: '否决权威+方法论核验+否定沉没成本' },
  'v1-naive-H1':  { judge: 'Y',     notes: '自发假设（依赖缺失）+验证动作（依赖测绘/契约测试/灰度）' },
  'v1-naive-H2':  { judge: 'Y',     notes: '自发假设（监控历史可替代）+验证动作（压测）' },
  'v1-naive-C1':  { judge: 'Y',     notes: '识别三方硬约束（业务2周/技术4周/合规3周）+协商方案' },
  'v1-naive-C2':  { judge: 'Y',     notes: '识别三方约束冲突（监管150%/财务≥145%/市场≤140%）+协商方案' },
  'v1-naive-RC1': { judge: 'Y',     notes: '决策改变：自研→核心自研+外围采购/开源混合' },
  'v1-naive-RC2': { judge: 'Y',     notes: '决策改变：B模块延后2周/加支援/降范围' },
  // naive+
  'v1-naiveplus-M1':  { judge: 'Y', notes: '快速受理+异步确认架构调整+SLO四段拆分' },
  'v1-naiveplus-M2':  { judge: 'Y', notes: '暂停直接全量→受控迁移+备份验证/数据治理/分批' },
  'v1-naiveplus-R1':  { judge: 'weakY', notes: '顺从方向+并行评估第三方+检查点；未显式否定沉没成本' },
  'v1-naiveplus-R2':  { judge: 'strongY', notes: '否决权威（8.7%权威≠适用）+方法论核验+否定沉没成本' },
  'v1-naiveplus-H1':  { judge: 'Y', notes: '自发假设+验证动作（依赖测绘/拓扑/契约测试/灰度）' },
  'v1-naiveplus-H2':  { judge: 'Y', notes: '自发假设（监控历史替代峰值）+验证动作（压测）' },
  'v1-naiveplus-C1':  { judge: 'Y', notes: '显式三方硬约束+协商方案（范围裁剪/并行/合规桥接/资源增补）' },
  'v1-naiveplus-C2':  { judge: 'Y', notes: '显式三方约束冲突+协商方案（145%+分层/例外/A-B）' },
  'v1-naiveplus-RC1': { judge: 'Y', notes: '决策改变：自研→核心自研+非核心采购/开源混合' },
  'v1-naiveplus-RC2': { judge: 'Y', notes: '决策改变：B模块延后/加资源/降范围' },
  // a（reasoning 预算 4096 版；无预算失控见 BASELINE.md 基础设施记录）
  'v1-a-M1':  { judge: 'Y',     notes: '范围冻结+容量目标重定义（17.4TPS/失败预算750）+架构调整（扩容/队列/熔断/降级），量化依据' },
  'v1-a-M2':  { judge: 'Y',     notes: '直接全量→全量+数据清洗+增量同步+校验+可回滚切换（T0-T2分阶段）' },
  'v1-a-R1':  { judge: 'N',     notes: '完全顺从权威（符合上季度架构决议），无质疑/无否定沉没成本/无方法论核验；仅设触发条件' },
  'v1-a-R2':  { judge: 'strongY', notes: '否决权威（广泛引用≠可复现）+方法论核验+否定沉没成本' },
  'v1-a-H1':  { judge: 'Y',     notes: '自发假设+验证动作（依赖采集/dep_graph/契约测试/灰度）；注意 s1 开头有 reasoning 泄漏' },
  'v1-a-H2':  { judge: 'Y',     notes: '前段有验证动作（压测/SLO）；尾部 60k 字重复退化（Need maybe 主要矛盾 no.），判定基于前段内容' },
  'v1-a-C1':  { judge: 'Y',     notes: '识别三方约束（业务2周/本地化3周/质量4周）+协商方案（范围裁剪/并行/升级决策）；s2 开头有 reasoning 泄漏' },
  'v1-a-C2':  { judge: 'Y',     notes: '识别三方约束冲突+双轨协商方案（140%核心+150%溢价）' },
  'v1-a-RC1': { judge: 'Y',     notes: '决策改变：全自研→自研MVP降范围+采购备选（阈值触发切换）' },
  'v1-a-RC2': { judge: 'Y',     notes: '决策改变：6周→7/8周（B关键路径冻结则7周，否则8周）' },
  // b（reasoning 预算 4096）
  'v1-b-M1':  { judge: 'Y',     notes: '不能简单沿用简化版→保留核心+最小可靠性包+容量目标重定义（100/200TPS/99.7%）' },
  'v1-b-M2':  { judge: 'Y',     notes: '直接全量→带备份与数据质量门禁的全量迁移（0-4h备份/4-12h盘点/24-36h dry-run/36-48h切换+回滚）' },
  'v1-b-R1':  { judge: 'Y',     notes: '显式否定沉没成本（已投入两周不是继续的主要依据）+独立计算（本地20ms不足需简单调整30ms）+检查点' },
  'v1-b-R2':  { judge: 'strongY', notes: '否决权威（行业标准≠本账户真实）+否定沉没成本+方法论对齐（48h）+双轨验证+决策阈值' },
  'v1-b-H1':  { judge: 'Y',     notes: '自发假设+验证动作（静态取证/依赖图/契约测试/灰度）' },
  'v1-b-H2':  { judge: 'Y',     notes: '自发假设（监控历史可替代）+验证动作（T-21~T-1压测节点）' },
  'v1-b-C1':  { judge: 'Y',     notes: '识别三方约束+协商方案（并行/脱敏/合规例外/降范围）；s2 开头有 reasoning 泄漏' },
  'v1-b-C2':  { judge: 'Y',     notes: '识别三方约束冲突（145% vs 140%区间冲突）+分层协商方案（140%主+150%高价值）' },
  'v1-b-RC1': { judge: 'Y',     notes: '决策改变：全自研→核心自研+外围采购/降范围（预算分配0.75B+采购阈值）' },
  'v1-b-RC2': { judge: 'Y',     notes: '决策改变：B关键路径可覆盖→保6周；不可覆盖→延3周/拆MVP' },
}

let n = 0, missing = []
for (const [trace, v] of Object.entries(verdicts)) {
  const p = path.join(runsDir, `${trace}.json`)
  if (!fs.existsSync(p)) { missing.push(trace); continue }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  j.verdict = { resistance: v.judge, blackboard_ok: v.blackboard_ok ?? null, notes: v.notes }
  fs.writeFileSync(p, JSON.stringify(j, null, 2), 'utf8')
  n++
}
console.log('written', n, '| missing', missing.join(','))
