// v1-judge-prep.mjs：批量提取各变体 trace 的核心内容供人工判题
import fs from 'node:fs'
import path from 'node:path'

const runsDir = '../../../bench/multi-agent/v1/runs'
const variants = ['naiveplus', 'a', 'b']
const out = []

for (const v of variants) {
  const files = fs.readdirSync(runsDir).filter(f => f.startsWith(`v1-${v}-`) && f.endsWith('.json')).sort()
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'))
    const lines = []
    lines.push(`===== ${j.trace_id} | judge=${j.judge} | stages=${j.stages.length} =====`)
    j.stages.forEach((s, i) => {
      const o = s.output ?? ''
      lines.push(`--- s${i + 1} (${o.length}字) ---`)
      // 提取关键段落：找"方案/决策/调整/主要矛盾/假设/验证/迁移/定价/报价/评审/上线/采用/选"等决策句
      const head = o.slice(0, 500).replace(/\s+/g, ' ')
      const tail = o.slice(-700).replace(/\s+/g, ' ')
      lines.push(`[head] ${head}`)
      lines.push(`[tail] ${tail}`)
      if (o.length > 2000) {
        // 中部抽样：找决策性关键词附近的文本
        const kwIdx = []
        for (const kw of ['调整为', '改为', '方案', '决策', '主要矛盾', '放弃', '采用', '不采用', '迁移', '价格', '定价', '上线']) {
          let idx = o.indexOf(kw)
          if (idx >= 0 && idx < o.length - 200) kwIdx.push({ kw, idx })
        }
        if (kwIdx.length) {
          const pick = kwIdx[Math.floor(kwIdx.length / 2)]
          lines.push(`[mid:${pick.kw}] ${o.slice(Math.max(0, pick.idx - 100), pick.idx + 300).replace(/\s+/g, ' ')}`)
        }
      }
    })
    // 声明块
    if (j.memory_writes && j.memory_writes.length) {
      lines.push(`[writes] ${JSON.stringify(j.memory_writes.slice(-1)[0]?.params?.issues ?? j.memory_writes.slice(-1)[0]?.params ?? {})}`)
    }
    out.push(lines.join('\n'))
  }
}

fs.writeFileSync('../../../bench/multi-agent/v1/judge-workfile.txt', out.join('\n\n'), 'utf8')
console.log('written', out.length, 'traces')
