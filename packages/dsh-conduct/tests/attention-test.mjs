// dsh-conduct 注意力三层嵌套层校验
// 运行：node attention-test.mjs（在 dsh-conduct 包目录下）
import {
  CONDUCT_TEXT, CONDUCT_CONTEXT_NAME, CONDUCT_CONTEXT_ORDER,
  ATTENTION_TEXT, ATTENTION_CONTEXT_NAME, ATTENTION_CONTEXT_ORDER,
} from '../src/index.ts'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

console.log('== 价值层 + 注意力三层嵌套校验 ==')

console.log('[1] context section 注册位（道天地将法之后、记忆快照之前）')
check('道天地将法 order=30 保留', CONDUCT_CONTEXT_ORDER === 30, `=${CONDUCT_CONTEXT_ORDER}`)
check('注意力层 order=31', ATTENTION_CONTEXT_ORDER === 31, `=${ATTENTION_CONTEXT_ORDER}`)
check('注意力紧邻道天地将法之后', ATTENTION_CONTEXT_ORDER === CONDUCT_CONTEXT_ORDER + 1)
check('名称 dsh-brain-conduct / dsh-brain-attention', CONDUCT_CONTEXT_NAME === 'dsh-brain-conduct' && ATTENTION_CONTEXT_NAME === 'dsh-brain-attention')

console.log('[2] 原价值层未被替代（增加非替换）')
check('道天地将法仍在', ['道', '天', '地', '将', '法'].every(k => CONDUCT_TEXT.includes(k)))
check('思维方法仍在', CONDUCT_TEXT.includes('矛盾分析') && CONDUCT_TEXT.includes('辩证发展') && CONDUCT_TEXT.includes('经济基础'))

console.log('[3] 注意力三层嵌套条款')
check('声明三层嵌套', ATTENTION_TEXT.includes('三层嵌套'))
check('L0 价值层·硬约束', ATTENTION_TEXT.includes('L0') && ATTENTION_TEXT.includes('硬约束'))
check('L1 当前任务', ATTENTION_TEXT.includes('L1') && ATTENTION_TEXT.includes('当前任务'))
check('L2 此刻上下文', ATTENTION_TEXT.includes('L2') && ATTENTION_TEXT.includes('此刻上下文'))
check('外层约束内层', ATTENTION_TEXT.includes('外层约束内层'))
check('L0 是不可突破的边界', ATTENTION_TEXT.includes('不得突破') && ATTENTION_TEXT.includes('以 L0 为准'))

console.log('[4] 危险信号被动打断（绕回 L0）')
check('危险信号立即停下、按 L0 处理、事后返回任务',
  ATTENTION_TEXT.includes('立即停下') && ATTENTION_TEXT.includes('按 L0 优先处理') && ATTENTION_TEXT.includes('再回到原任务'))

console.log('[5] 检索预算三档经单一 brain 入口的 search 动作联动')
for (const k of ['high', 'normal', 'low']) check(`保留预算档 ${k}`, ATTENTION_TEXT.includes(k))
check('只出现单一入口与 action=search，不再暴露 brain_memory_search',
  ATTENTION_TEXT.includes('brain') && ATTENTION_TEXT.includes('search') && !ATTENTION_TEXT.includes('brain_memory_search'))

console.log('[6] dispatcher 去诱导（简单任务直接做，按需点名）')
check('默认直接动手', ATTENTION_TEXT.includes('默认直接动手'))
check('简单任务不要调用脑工具', ATTENTION_TEXT.includes('简单任务不要调用任何脑工具'))
check('一次只点一个能力', ATTENTION_TEXT.includes('一次只点一个能力'))
check('矛盾分析走 contradiction 动作', ATTENTION_TEXT.includes('contradiction'))

console.log('[7] 交付纪律（交付即止，不自发造测试空转）')
check('含交付纪律段', ATTENTION_TEXT.includes('[交付纪律]'))
check('成品满足需求后立即停下', ATTENTION_TEXT.includes('立即停下并汇报'))
check('不自发新建测试/框架/mock', ATTENTION_TEXT.includes('不要自发新建测试文件、测试框架或 mock/验证脚本'))
check('不加需求外功能', ATTENTION_TEXT.includes('不加需求之外的功能'))
check('保留例外：用户要求测试', ATTENTION_TEXT.includes('用户明确要求测试或验证'))
check('保留例外：真缺陷直接改成品', ATTENTION_TEXT.includes('有真实缺陷') && ATTENTION_TEXT.includes('直接改成品本身'))
check('保留例外：高风险先确认', ATTENTION_TEXT.includes('不可逆或高风险操作，先与用户确认'))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
