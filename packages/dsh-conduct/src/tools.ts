/**
 * Model-facing conduct tools: the contradiction-analysis guidance tool.
 *
 * The tool is deliberately GUIDANCE, not delegation: it returns a deterministic
 * analysis framework and hands the reasoning back to the model, forcing a
 * contradiction ranking before any conclusion. It never fabricates a verdict
 * for a problem it has not thought about.
 * @module @deepseek-ai/dsh-conduct/src/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

/** Render the contradiction-analysis guidance framework for one question. */
export function renderContradictionAnalysis(question: string, facts: string | undefined): string {
  const factBlock = facts !== undefined && facts.trim() !== ''
    ? `已知事实：${facts.trim()}`
    : '已知事实：（未提供，请先用检索或阅读补全背景，再进入分析）'
  return `矛盾分析法 · 引导框架（请按此结构完成分析后再给结论，不要跳过分析）

分析对象：${question}
${factBlock}

1. 主要矛盾：先指出当前决定全局走向的 1~2 个核心对立点（哪个不解决，其他都是空转？）。
2. 次要矛盾：列出其余影响要素（本轮可不处理，但要点名）。
3. 转化条件：何种情况下主次矛盾会转化？现在是否已接近转化点？
4. 同一性与斗争性：矛盾双方是否相互依存？可否转化、可否共存？
5. 行动建议：基于主要矛盾，给出一个最优先动作与一个可暂缓项。

规则：必须先完成 1~4 再给建议；结论必须能回溯到某一对矛盾，禁止跳过分析直接下结论。`
}

/** Register every conduct tool on `ctx.tools`. */
export function registerConductTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'brain_analyze_contradiction',
    description:
      '矛盾分析法：对复杂问题输出主次矛盾排序与引导框架，不直接给结论。'
      + '用于问题盘根错节、需要先想清楚再动手，或用户征求决策建议时。',
    parameters: {
      question: { type: 'string', required: true, description: '待分析的问题或情境，越具体越好。' },
      facts: { type: 'string', description: '已知事实与背景（可选）；留空则先补全背景再分析。' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, _exec) => renderContradictionAnalysis(args.question, args.facts),
    presentCall: args => ({ card: 'generic', title: '矛盾分析', kind: 'other', rawInput: args.question }),
  }))
}
