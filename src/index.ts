/**
 * dsh-cache-billing — 缓存账单 host 端。
 *
 * 唯一职责：注册一个 session projection 单元 cacheBilling，盯住最新一次大模型 API 请求的缓存命中 token 数，按 DeepSeek 峰谷价折算成金额，随推送帧直推浏览器，零轮询零路由。
 *
 * 一轮的定义：每次请求大模型 API 算一轮。人类说话之后 AI 可能多次调用工具，工具结果又返回给大模型请求 API，每次请求算一轮。会话事件流中即 turn 和 step：同一 step 的 chunk 流式样本被 assistant/message 最终样本替换，官方 token-meter 同款替换语义；新 step 出现即覆盖上一轮，只显示当前步。turn 是一个用户消息内的多步合计，切换用户消息时重置。
 *
 * 计价口径：本步 cacheReadTokens × 该模型该时刻的缓存命中单价 ÷ 1e6。缓存命中 token 读 usage.cacheReadTokens，DSH adapter 映射自 DeepSeek API 响应的 prompt_cache_hit_tokens。峰谷判定只用事件时间戳做 UTC+8 数学换算，北京 9–12、14–18 点为峰，其余半价，与系统时区无关，本机系统时间不可信。模型从 request/header、request/context 跟踪，assistant/message 的 message.source.model 校正，flash 与 pro 单价不同，认错模型就算错钱。第三方中转同样显示：provider 非空即放行，模型命中价目表就按估算金额计价。
 */

import { z } from 'zod'

/** 插件名，与 cordis.patch.yml 的 name 一致，loader 诊断用。 */
export const name = 'dsh-cache-billing'

/** 必需服务：sessionProjections 由 @deepseek-ai/dsh-session-projection 提供。 */
export const inject = ['sessionProjections']

// ── 价格表：CNY 元 / 百万 token，2026-08-17 官方峰谷价，多插件源码交叉验证一致 ──
// 时段政策：2026-08-22 起周六日全天谷价，仅工作日有峰价，用户转发官方邮件告知。

interface RateRow {
  /** 缓存命中输入单价 */
  cacheHit: number
  /** 未命中输入单价（含缓存写入） */
  cacheMiss: number
  /** 输出单价 */
  output: number
}

/** 峰谷价模型表，无平价模型，所有模型都参与峰谷，vision-exp 与 flash 同价。 */
const PEAK_RATES: Record<string, RateRow> = {
  'deepseek-v4-flash': { cacheHit: 0.1, cacheMiss: 3, output: 9 },
  'deepseek-v4-flash-vision-exp': { cacheHit: 0.1, cacheMiss: 3, output: 9 },
  'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
}
const OFFPEAK_RATES: Record<string, RateRow> = {
  'deepseek-v4-flash': { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  'deepseek-v4-flash-vision-exp': { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
}
/** 兜底价：未知模型按 flash 峰谷价估算，宁近似不空转。 */
const FALLBACK: RateRow = PEAK_RATES['deepseek-v4-flash']

type Tier = 'peak' | 'offPeak'

/**
 * 时刻是否为北京高峰。纯 UTC+8 数学换算，与系统时区无关，红线。政策：周六日全天谷价，仅工作日有峰价；工作日峰段仍为 09:00–12:00、14:00–18:00 北京时间。
 */
function isPeakBeijing(timeMs: number): boolean {
  const shifted = timeMs + 8 * 3600 * 1000
  const shiftedDate = new Date(shifted)
  const day = shiftedDate.getUTCDay() // 0=周日 6=周六，同一 shifted 时刻取星期与小时，跨日一致
  if (day === 0 || day === 6) return false // 周末全天谷价
  const hour = shiftedDate.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** 模型在某时刻的费率行：先精确匹配，再用后缀匹配吃掉带命名空间前缀的名字。 */
function rateOf(model: string | null, timeMs: number): { row: RateRow; tier: Tier } {
  const key = (model ?? '').toLowerCase()
  const peak = isPeakBeijing(timeMs)
  const table = peak ? PEAK_RATES : OFFPEAK_RATES
  if (key in table) return { row: table[key], tier: peak ? 'peak' : 'offPeak' }
  for (const [suffix, row] of Object.entries(table)) {
    if (key.endsWith(suffix)) return { row, tier: peak ? 'peak' : 'offPeak' }
  }
  return { row: FALLBACK, tier: peak ? 'peak' : 'offPeak' }
}

const round9 = (n: number): number => Math.round(n * 1e9) / 1e9

/** 一个 usage 样本，state.last 只存最新一轮。 */
interface Sample {
  turn: number
  step: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  model: string | null
  provider: string | null
  /** 事件时刻 epoch ms，峰谷判定与明细说明都用它，不用当前时钟 */
  time: number
}

/** 会话累计，跨轮逐笔按各自事件时刻费率计价，而非按最新时刻统算。 */
interface Totals {
  /** 缓存命中金额累计，元 */
  cacheHitCost: number
  /** 未命中输入含缓存写入金额累计，元 */
  missCost: number
  /** 输出金额累计，元 */
  outputCost: number
  /** 输入 token 累计，命中加未命中加写入 */
  inputTokens: number
  /** 缓存命中 token 累计，明细行展示用 */
  cacheReadTokens: number
  /** 输出 token 累计 */
  outputTokens: number
  /** 有 usages 的 step 数，同 step 替换不重复计 */
  rounds: number
  /** 缓存失效 step 数，发生过缓存写入，DeepSeek 官方不报写入字段，多数路由恒为 0，个别中转报值时生效 */
  missSteps: number
  /** 缓存写入 token 量累计，同上，仅部分中转有值 */
  writeTokens: number
  /** 完全失效 step 数，有输入但缓存命中为 0，整条上下文缓存全没吃上，由 cacheReadTokens 推导，任何路由都可靠 */
  fullMissSteps: number
}

/** 当前轮累计，一个用户消息内多次 API 调用的合计，turn 切换时重置。 */
interface TurnTotals {
  /** turn 序号 */
  id: number
  /** 缓存命中金额累计 */
  hitCost: number
  /** 未命中输入金额累计 */
  missCost: number
  /** 输出金额累计 */
  outputCost: number
  /** 输入 token 累计，命中加未命中加写入 */
  inputTokens: number
  /** 缓存命中 token 累计，明细行展示用 */
  cacheReadTokens: number
  /** 输出 token 累计 */
  outputTokens: number
}

/** 按样本模型与事件时刻计算一轮三笔费用，元，round9 防精度漂移。 */
function costOf(sample: Sample): { hit: number; miss: number; output: number } {
  const { row } = rateOf(sample.model, sample.time)
  return {
    hit: round9((sample.cacheReadTokens * row.cacheHit) / 1e6),
    miss: round9(((sample.inputTokens + sample.cacheWriteTokens) * row.cacheMiss) / 1e6),
    output: round9((sample.outputTokens * row.output) / 1e6),
  }
}

/** 缓存失效判定：发生过缓存写入。写入即失效，官方不报写入，多数路由为 false。 */
const isWriteMiss = (s: Sample): boolean => s.cacheWriteTokens > 0

/** 完全失效判定：有输入但缓存命中为 0，整条上下文缓存全没吃上。由 cacheReadTokens 推导，任何路由都可靠，首轮无缓存可命中也算，近似。 */
const isFullMiss = (s: Sample): boolean =>
  s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens > 0 && s.cacheReadTokens === 0

interface ProjectionState {
  /** 当前请求的 provider，request/header 跟踪，message.source 校正 */
  provider: string | null
  /** 当前请求的 model */
  model: string | null
  /** 最新一轮 usage 样本，新 step 直接覆盖 */
  last: Sample | null
  /** 当前轮累计，turn 切换时重置 */
  turn: TurnTotals | null
  /** 会话累计金额与轮数 */
  totals: Totals
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: any, _config: any): void {
  ctx.inject(['sessionProjections'], (projectionCtx: any) => {
    // 新版 0.1.1-rc.2 契约：{ key, stateSchema, init, apply, wire: {viewSchema, view}, stateVersion }
    // 没有 wire 即 host-only 单元，状态不进客户端快照，useProjection 永远拿不到值。
    projectionCtx.sessionProjections.register({
      key: 'cacheBilling',
      // v5：state.totals/turn 增加 cacheReadTokens 累计，明细行 token 展示，旧持久化行作废重放
      stateVersion: 5,
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
        turn: z
          .object({
            id: z.number().int(),
            hitCost: z.number().nonnegative(),
            missCost: z.number().nonnegative(),
            outputCost: z.number().nonnegative(),
            inputTokens: z.number().int().nonnegative(),
            cacheReadTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
          })
          .nullable(),
        totals: z.object({
          cacheHitCost: z.number().nonnegative(),
          missCost: z.number().nonnegative(),
          outputCost: z.number().nonnegative(),
          inputTokens: z.number().int().nonnegative(),
          cacheReadTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
          rounds: z.number().int().nonnegative(),
          missSteps: z.number().int().nonnegative(),
          writeTokens: z.number().int().nonnegative(),
          fullMissSteps: z.number().int().nonnegative(),
        }),
      }),
      init: (): ProjectionState => ({
        provider: null,
        model: null,
        last: null,
        turn: null,
        totals: {
          cacheHitCost: 0,
          missCost: 0,
          outputCost: 0,
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          rounds: 0,
          missSteps: 0,
          writeTokens: 0,
          fullMissSteps: 0,
        },
      }),

      apply: (state: ProjectionState, event: any): ProjectionState => {
        // 跟踪当前请求的 provider 与 model
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

        // usage 样本，一轮就是一个 step
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
          // 与本单元无关的事件：返回同一引用，驱动以 Object.is 把关变更流
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
        // 同一 step 的替换样本，chunk 流式到 final message，数据全同则引用不变
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
        // 新 step 是新一轮，覆盖上一轮；同 step 新样本是替换。
        // 会话累计随之维护：同 step 替换扣旧样本款加新样本款，不增轮数；新 step 整轮累加、轮数加一。失效计数同样遵循替换语义扣旧加新。
        // 当前轮累计：同 turn 累加，turn 切换重置，同 step 替换扣旧加新。
        const current = costOf(sample)
        const writeMiss = isWriteMiss(sample)
        const fullMiss = isFullMiss(sample)
        const sampleInputTokens = sample.inputTokens + sample.cacheReadTokens + sample.cacheWriteTokens
        if (prev !== null && prev.turn === turn && prev.step === step) {
          const old = costOf(prev)
          const prevInputTokens = prev.inputTokens + prev.cacheReadTokens + prev.cacheWriteTokens
          const turnBase =
            state.turn !== null && state.turn.id === prev.turn
              ? state.turn
              : {
                  id: turn,
                  hitCost: 0,
                  missCost: 0,
                  outputCost: 0,
                  inputTokens: 0,
                  cacheReadTokens: 0,
                  outputTokens: 0,
                }
          return {
            ...state,
            last: sample,
            turn: {
              ...turnBase,
              id: turn,
              hitCost: turnBase.hitCost - old.hit + current.hit,
              missCost: turnBase.missCost - old.miss + current.miss,
              outputCost: turnBase.outputCost - old.output + current.output,
              inputTokens: turnBase.inputTokens - prevInputTokens + sampleInputTokens,
              cacheReadTokens:
                turnBase.cacheReadTokens - prev.cacheReadTokens + sample.cacheReadTokens,
              outputTokens: turnBase.outputTokens - prev.outputTokens + sample.outputTokens,
            },
            totals: {
              cacheHitCost: state.totals.cacheHitCost - old.hit + current.hit,
              missCost: state.totals.missCost - old.miss + current.miss,
              outputCost: state.totals.outputCost - old.output + current.output,
              inputTokens: state.totals.inputTokens - prevInputTokens + sampleInputTokens,
              cacheReadTokens:
                state.totals.cacheReadTokens - prev.cacheReadTokens + sample.cacheReadTokens,
              outputTokens: state.totals.outputTokens - prev.outputTokens + sample.outputTokens,
              rounds: state.totals.rounds,
              missSteps: state.totals.missSteps - (isWriteMiss(prev) ? 1 : 0) + (writeMiss ? 1 : 0),
              writeTokens: state.totals.writeTokens - prev.cacheWriteTokens + sample.cacheWriteTokens,
              fullMissSteps:
                state.totals.fullMissSteps - (isFullMiss(prev) ? 1 : 0) + (fullMiss ? 1 : 0),
            },
          }
        }
        const sameTurn = state.turn !== null && state.turn.id === turn
        return {
          ...state,
          last: sample,
          turn: sameTurn
            ? {
                ...state.turn!,
                hitCost: state.turn!.hitCost + current.hit,
                missCost: state.turn!.missCost + current.miss,
                outputCost: state.turn!.outputCost + current.output,
                inputTokens: state.turn!.inputTokens + sampleInputTokens,
                cacheReadTokens: state.turn!.cacheReadTokens + sample.cacheReadTokens,
                outputTokens: state.turn!.outputTokens + sample.outputTokens,
              }
            : {
                id: turn,
                hitCost: current.hit,
                missCost: current.miss,
                outputCost: current.output,
                inputTokens: sampleInputTokens,
                cacheReadTokens: sample.cacheReadTokens,
                outputTokens: sample.outputTokens,
              },
          totals: {
            cacheHitCost: state.totals.cacheHitCost + current.hit,
            missCost: state.totals.missCost + current.miss,
            outputCost: state.totals.outputCost + current.output,
            inputTokens: state.totals.inputTokens + sampleInputTokens,
            cacheReadTokens: state.totals.cacheReadTokens + sample.cacheReadTokens,
            outputTokens: state.totals.outputTokens + sample.outputTokens,
            rounds: state.totals.rounds + 1,
            missSteps: state.totals.missSteps + (writeMiss ? 1 : 0),
            writeTokens: state.totals.writeTokens + sample.cacheWriteTokens,
            fullMissSteps: state.totals.fullMissSteps + (fullMiss ? 1 : 0),
          },
        }
      },

      wire: {
        viewSchema: z.object({
          available: z.boolean(),
          /** 缓存命中部分花费 */
          cost: z.number().nonnegative(),
          /** 未命中输入含缓存写入花费 */
          missCost: z.number().nonnegative(),
          /** 输出花费 */
          outputCost: z.number().nonnegative(),
          currency: z.literal('CNY'),
          cacheReadTokens: z.number().int().nonnegative(),
          totalInputTokens: z.number().int().nonnegative(),
          /** 当前步输出 token */
          outputTokens: z.number().int().nonnegative(),
          hitRate: z.number().nullable(),
          model: z.string().nullable(),
          provider: z.string().nullable(),
          tier: z.enum(['peak', 'offPeak']).nullable(),
          unitPricePerM: z.number().nullable(),
          turn: z.number().int().nullable(),
          step: z.number().int().nullable(),
          /** 当前轮金额总额，命中加未命中加输出 */
          turnCost: z.number().nonnegative(),
          /** 当前轮缓存命中金额 */
          turnHitCost: z.number().nonnegative(),
          /** 当前轮未命中输入金额 */
          turnMissCost: z.number().nonnegative(),
          /** 当前轮输出金额 */
          turnOutputCost: z.number().nonnegative(),
          /** 当前轮 token 总额，输入加输出 */
          turnTokens: z.number().int().nonnegative(),
          /** 当前轮缓存命中 token 累计 */
          turnCacheReadTokens: z.number().int().nonnegative(),
          /** 当前轮输入 token 累计，命中加未命中加写入 */
          turnInputTokens: z.number().int().nonnegative(),
          /** 当前轮 输出 token 累计 */
          turnOutputTokens: z.number().int().nonnegative(),
          /** 会话累计输入 token 总额，命中加未命中加写入 */
          sessionInputTokens: z.number().int().nonnegative(),
          /** 会话累计：缓存命中 token 总额 */
          sessionCacheReadTokens: z.number().int().nonnegative(),
          /** 会话累计：输出 token 总额 */
          sessionOutputTokens: z.number().int().nonnegative(),
          /** 会话累计：缓存命中金额 */
          sessionCacheHitCost: z.number().nonnegative(),
          /** 会话累计：未命中金额 */
          sessionMissCost: z.number().nonnegative(),
          /** 会话累计：输出金额 */
          sessionOutputCost: z.number().nonnegative(),
          /** 会话累计：已有用量的轮数 */
          sessionRounds: z.number().int().nonnegative(),
          /** 会话累计缓存失效 step 数，发生过缓存写入，仅部分中转有值 */
          sessionMissSteps: z.number().int().nonnegative(),
          /** 会话累计缓存写入 token 量，同上 */
          sessionWriteTokens: z.number().int().nonnegative(),
          /** 会话累计完全失效 step 数，有输入但缓存命中为 0，任何路由都可靠 */
          sessionFullMissSteps: z.number().int().nonnegative(),
        }),
        view: (state: ProjectionState) => {
          const s = state.last
          const sessionTotals = state.totals
          if (s === null) {
            return {
              available: false,
              cost: 0,
              missCost: 0,
              outputCost: 0,
              currency: 'CNY' as const,
              cacheReadTokens: 0,
              totalInputTokens: 0,
              outputTokens: 0,
              hitRate: null,
              model: state.model,
              provider: state.provider,
              tier: null,
              unitPricePerM: null,
              turn: null,
              step: null,
              turnCost: 0,
              turnHitCost: 0,
              turnMissCost: 0,
              turnOutputCost: 0,
              turnTokens: 0,
              turnCacheReadTokens: 0,
              turnInputTokens: 0,
              turnOutputTokens: 0,
              sessionCacheHitCost: sessionTotals.cacheHitCost,
              sessionMissCost: sessionTotals.missCost,
              sessionOutputCost: sessionTotals.outputCost,
              sessionInputTokens: sessionTotals.inputTokens,
              sessionCacheReadTokens: sessionTotals.cacheReadTokens,
              sessionOutputTokens: sessionTotals.outputTokens,
              sessionRounds: sessionTotals.rounds,
              sessionMissSteps: sessionTotals.missSteps,
              sessionWriteTokens: sessionTotals.writeTokens,
              sessionFullMissSteps: sessionTotals.fullMissSteps,
            }
          }
          const totalInput = s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens
          const { row, tier } = rateOf(s.model, s.time)
          const cost = round9((s.cacheReadTokens * row.cacheHit) / 1e6)
          const missCost = round9(((s.inputTokens + s.cacheWriteTokens) * row.cacheMiss) / 1e6)
          const outputCost = round9((s.outputTokens * row.output) / 1e6)
          const turn = state.turn
          return {
            available: totalInput > 0 || s.outputTokens > 0,
            cost,
            missCost,
            outputCost,
            currency: 'CNY' as const,
            cacheReadTokens: s.cacheReadTokens,
            totalInputTokens: totalInput,
            outputTokens: s.outputTokens,
            hitRate:
              totalInput > 0 ? Math.round((s.cacheReadTokens / totalInput) * 1000) / 10 : null,
            model: s.model,
            provider: s.provider,
            tier,
            unitPricePerM: row.cacheHit,
            turn: s.turn,
            step: s.step,
            turnCost:
              turn === null ? 0 : turn.hitCost + turn.missCost + turn.outputCost,
            turnHitCost: turn === null ? 0 : turn.hitCost,
            turnMissCost: turn === null ? 0 : turn.missCost,
            turnOutputCost: turn === null ? 0 : turn.outputCost,
            turnTokens: turn === null ? 0 : turn.inputTokens + turn.outputTokens,
            turnCacheReadTokens: turn === null ? 0 : turn.cacheReadTokens,
            turnInputTokens: turn === null ? 0 : turn.inputTokens,
            turnOutputTokens: turn === null ? 0 : turn.outputTokens,
            sessionCacheHitCost: sessionTotals.cacheHitCost,
            sessionMissCost: sessionTotals.missCost,
            sessionOutputCost: sessionTotals.outputCost,
            sessionInputTokens: sessionTotals.inputTokens,
            sessionCacheReadTokens: sessionTotals.cacheReadTokens,
            sessionOutputTokens: sessionTotals.outputTokens,
            sessionRounds: sessionTotals.rounds,
            sessionMissSteps: sessionTotals.missSteps,
            sessionWriteTokens: sessionTotals.writeTokens,
            sessionFullMissSteps: sessionTotals.fullMissSteps,
          }
        },
      },
    })
  })
}
