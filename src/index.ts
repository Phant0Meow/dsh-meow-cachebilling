/**
 * meow-cachebilling — 喵账单（host 端）。
 *
 * 唯一职责：注册一个 session projection 单元 `cacheBilling`，盯住最新一次
 * 大模型 API 请求的缓存命中 token 数，按 DeepSeek 官方峰谷价折算成金额，
 * 随 session/projection 推送帧直推浏览器——零轮询零路由。
 *
 * 「一轮」的定义（用户原话）：每次请求大模型 API 算一轮；人类说话之后 AI
 * 可能多次调用工具，工具结果又返回给大模型请求 API，每次请求算一轮。
 * 会话事件流中即 (turn, step) 的 step：同一 step 的 chunk 流式样本被
 * assistant/message 最终样本替换（官方 token-meter 同款替换语义）；新 step
 * 出现即覆盖上一轮——只显示当前轮。
 *
 * 计价口径：本轮 cacheReadTokens × 该模型该时刻的缓存命中单价 ÷ 1e6。
 * - 缓存命中 token 读 usage.cacheReadTokens（DSH adapter 映射自 DeepSeek
 *   API 响应的 prompt_cache_hit_tokens，官方直接返回）。
 * - 峰谷判定只用事件时间戳做 UTC+8 数学换算（北京 9–12 / 14–18 点为峰，
 *   其余半价），与系统时区无关——本机系统时间不可信（红线）。
 * - 模型从 request/header、request/context 跟踪，assistant/message 的
 *   message.source.model 校正——flash/pro 单价不同，认错模型就算错钱。
 * - 仅 DeepSeek 官方路由显示：provider 随投影下发，client 端判定
 *   （真实 provider 字符串值由 probe 日志校准）。
 */

import { z } from 'zod'

/** 插件名（loader 诊断用；与 cordis.patch.yml 的 name 一致）。 */
export const name = 'meow-cachebilling'

/** 必需服务：sessionProjections 由 @deepseek-ai/dsh-session-projection 提供。 */
export const inject = ['sessionProjections']

// ── 价格表（CNY 元 / 百万 token；2026-08-17 官方峰谷价，多插件源码交叉验证一致）──
// 时段政策：2026-08-22 起周六日全天谷价，仅工作日有峰价（用户转发官方邮件告知）。

interface RateRow {
  /** 缓存命中输入单价 */
  cacheHit: number
  /** 未命中输入单价（含缓存写入） */
  cacheMiss: number
  /** 输出单价 */
  output: number
}

/** 峰谷价模型表 */
const PEAK_RATES: Record<string, RateRow> = {
  'deepseek-v4-flash': { cacheHit: 0.1, cacheMiss: 3, output: 9 },
  'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
}
const OFFPEAK_RATES: Record<string, RateRow> = {
  'deepseek-v4-flash': { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
}
/** 平价模型（不参与峰谷，官方标准价沿用） */
const FLAT_RATES: Record<string, RateRow> = {
  'deepseek-chat': { cacheHit: 0.5, cacheMiss: 2, output: 8 },
  'deepseek-reasoner': { cacheHit: 1, cacheMiss: 4, output: 16 },
}
/** 兜底价：未知模型按 flash 峰谷价估算（宁近似，不空转） */
const FALLBACK: RateRow = PEAK_RATES['deepseek-v4-flash']

type Tier = 'peak' | 'offPeak' | 'flat'

/**
 * 时刻是否为北京高峰。纯 UTC+8 数学换算，与系统时区无关（红线）。
 * 政策（2026-08-22 用户转发官方邮件）：周六日全天谷价，仅工作日有峰价；
 * 工作日峰段仍为 09:00–12:00 / 14:00–18:00（北京时间）。
 */
function isPeakBeijing(timeMs: number): boolean {
  const shifted = timeMs + 8 * 3600 * 1000
  const shiftedDate = new Date(shifted)
  const day = shiftedDate.getUTCDay() // 0=周日 6=周六（同一 shifted 时刻取星期与小时，跨日一致）
  if (day === 0 || day === 6) return false // 周末全天谷价
  const hour = shiftedDate.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** 模型在某时刻的费率行：先精确匹配，再用后缀匹配吃掉带命名空间前缀的名字。 */
function rateOf(model: string | null, timeMs: number): { row: RateRow; tier: Tier } {
  const key = (model ?? '').toLowerCase()
  if (key in FLAT_RATES) return { row: FLAT_RATES[key], tier: 'flat' }
  const peak = isPeakBeijing(timeMs)
  const table = peak ? PEAK_RATES : OFFPEAK_RATES
  if (key in table) return { row: table[key], tier: peak ? 'peak' : 'offPeak' }
  for (const [suffix, row] of Object.entries(table)) {
    if (key.endsWith(suffix)) return { row, tier: peak ? 'peak' : 'offPeak' }
  }
  for (const [suffix, row] of Object.entries(FLAT_RATES)) {
    if (key.endsWith(suffix)) return { row, tier: 'flat' }
  }
  return { row: FALLBACK, tier: peak ? 'peak' : 'offPeak' }
}

const round9 = (n: number): number => Math.round(n * 1e9) / 1e9

/** 一轮 usage 样本（state.last 只存最新一轮）。 */
interface Sample {
  turn: number
  step: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  model: string | null
  provider: string | null
  /** 事件时刻（epoch ms）：峰谷判定与明细说明都用它，不用当前时钟 */
  time: number
}

interface ProjectionState {
  /** 当前请求的 provider（request/header 跟踪，message.source 校正） */
  provider: string | null
  /** 当前请求的 model */
  model: string | null
  /** 最新一轮的 usage 样本；新 step 直接覆盖 */
  last: Sample | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: any, _config: any): void {
  ctx.inject(['sessionProjections'], (projectionCtx: any) => {
    // 新版(0.1.1-rc.2)契约：{ key, stateSchema, init, apply, wire: {viewSchema, view}, stateVersion }
    // 没有 wire 即 host-only 单元——状态不进客户端快照，useProjection 永远拿不到值。
    projectionCtx.sessionProjections.register({
      key: 'cacheBilling',
      stateVersion: 1,
      stateSchema: z.object({
        provider: z.string().nullable(),
        model: z.string().nullable(),
        last: z
          .object({
            turn: z.number().int(),
            step: z.number().int(),
            inputTokens: z.number().int().nonnegative(),
            cacheReadTokens: z.number().int().nonnegative(),
            cacheWriteTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
            model: z.string().nullable(),
            provider: z.string().nullable(),
            time: z.number(),
          })
          .nullable(),
      }),
      init: (): ProjectionState => ({ provider: null, model: null, last: null }),

      apply: (state: ProjectionState, event: any): ProjectionState => {
        // ── 跟踪当前请求的 provider / model ──
        if (event.type === 'request/header') {
          const cfg = event.data?.header?.config
          const provider =
            typeof cfg?.provider === 'string' && cfg.provider !== '' ? cfg.provider : state.provider
          const model =
            typeof cfg?.model === 'string' && cfg.model !== '' ? cfg.model : state.model
          if (provider !== state.provider || model !== state.model) {
            return { ...state, provider, model }
          }
          return state
        }
        if (event.type === 'request/context') {
          const raw = event.data?.model
          const model = typeof raw === 'string' && raw !== '' ? raw : state.model
          return model !== state.model ? { ...state, model } : state
        }

        // ── usage 样本（一轮 = 一个 step）──
        let turn: unknown
        let step: unknown
        let usage: any
        let sourceModel: string | undefined
        let sourceProvider: string | undefined
        if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') {
          turn = event.data.turn
          step = event.data.step
          usage = event.data.chunk.usage
        } else if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
          turn = event.data.turn
          step = event.data.step
          usage = event.data.usage
          const source = event.data.message?.source
          if (typeof source?.provider === 'string') sourceProvider = source.provider
          if (typeof source?.model === 'string') sourceModel = source.model
        } else {
          // 与本单元无关的事件：返回同一引用（驱动以 Object.is 把关变更流）
          return state
        }
        if (usage === undefined || typeof turn !== 'number' || typeof step !== 'number') {
          return state
        }

        const sample: Sample = {
          turn,
          step,
          inputTokens: Number(usage.inputTokens) || 0,
          cacheReadTokens: Number(usage.cacheReadTokens) || 0,
          cacheWriteTokens: Number(usage.cacheWriteTokens) || 0,
          outputTokens: Number(usage.outputTokens) || 0,
          model: sourceModel ?? state.model,
          provider: sourceProvider ?? state.provider,
          time: typeof event.time === 'number' ? event.time : Date.now(),
        }

        const prev = state.last
        // 同一 step 的替换样本（chunk 流式 → final message）：数据全同则引用不变
        if (
          prev !== null &&
          prev.turn === turn &&
          prev.step === step &&
          prev.inputTokens === sample.inputTokens &&
          prev.cacheReadTokens === sample.cacheReadTokens &&
          prev.cacheWriteTokens === sample.cacheWriteTokens &&
          prev.outputTokens === sample.outputTokens &&
          prev.model === sample.model &&
          prev.provider === sample.provider
        ) {
          return state
        }
        // 新 step（新一轮）→ 覆盖上一轮；同 step 新样本 → 替换
        return { ...state, last: sample }
      },

      wire: {
        viewSchema: z.object({
          available: z.boolean(),
          /** 缓存命中部分花费 */
          cost: z.number().nonnegative(),
          /** 未命中输入（含缓存写入）花费 */
          missCost: z.number().nonnegative(),
          /** 输出花费 */
          outputCost: z.number().nonnegative(),
          currency: z.literal('CNY'),
          cacheReadTokens: z.number().int().nonnegative(),
          totalInputTokens: z.number().int().nonnegative(),
          hitRate: z.number().nullable(),
          model: z.string().nullable(),
          provider: z.string().nullable(),
          tier: z.enum(['peak', 'offPeak', 'flat']).nullable(),
          unitPricePerM: z.number().nullable(),
          turn: z.number().int().nullable(),
          step: z.number().int().nullable(),
        }),
        view: (state: ProjectionState) => {
          const s = state.last
          if (s === null) {
            return {
              available: false,
              cost: 0,
              missCost: 0,
              outputCost: 0,
              currency: 'CNY' as const,
              cacheReadTokens: 0,
              totalInputTokens: 0,
              hitRate: null,
              model: state.model,
              provider: state.provider,
              tier: null,
              unitPricePerM: null,
              turn: null,
              step: null,
            }
          }
          const totalInput = s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens
          const { row, tier } = rateOf(s.model, s.time)
          const cost = round9((s.cacheReadTokens * row.cacheHit) / 1e6)
          const missCost = round9(((s.inputTokens + s.cacheWriteTokens) * row.cacheMiss) / 1e6)
          const outputCost = round9((s.outputTokens * row.output) / 1e6)
          return {
            available: totalInput > 0 || s.outputTokens > 0,
            cost,
            missCost,
            outputCost,
            currency: 'CNY' as const,
            cacheReadTokens: s.cacheReadTokens,
            totalInputTokens: totalInput,
            hitRate:
              totalInput > 0 ? Math.round((s.cacheReadTokens / totalInput) * 1000) / 10 : null,
            model: s.model,
            provider: s.provider,
            tier,
            unitPricePerM: row.cacheHit,
            turn: s.turn,
            step: s.step,
          }
        },
      },
    })
  })
}
