/**
 * meow-cachebilling — 缓存账单 host 端。
 *
 * 唯一职责：注册一个 session projection 单元 cacheBilling，盯住最新一次大模型 API 请求的缓存命中 token 数，按价目表折算成金额，随推送帧直推浏览器，零轮询零路由。
 *
 * 一轮的定义：每次请求大模型 API 算一轮。人类说话之后 AI 可能多次调用工具，工具结果又返回给大模型请求 API，每次请求算一轮。会话事件流中即 turn 和 step：同一 step 的 chunk 流式样本被 assistant/message 最终样本替换，官方 token-meter 同款替换语义；新 step 出现即覆盖上一轮，只显示当前步。turn 是一个用户消息内的多步合计，切换用户消息时重置。
 *
 * 价目表：包根 rates.yml（可手填，重启生效）。条目三选一：peak+valley（valley 自动取 peak 的补集）或 const（一口价）；when = days × ranges 叉乘，start 含、end 不含。timezone 是计费方账单时区（IANA 名），峰谷判定用 Intl 从事件时间戳取条目时区的星期与时分，不碰系统本地时区（本机系统时间不可信，红线）。
 *
 * 模型匹配：provider 限定条目优先于通配条目，各自内部精确→后缀，大小写不敏感；未命中任何条目按内置 deepseek-v4-flash 表估算（matched=false，客户端标注「估算」）。费率按每步事件时刻逐笔判定，跨步不比价。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/** 插件名，与 cordis.patch.yml 的 name 一致，loader 诊断用。 */
export const name = 'meow-cachebilling'

/** 必需服务：sessionProjections 由 @deepseek-ai/dsh-session-projection 提供。 */
export const inject = ['sessionProjections']

// ── 价目表（单位：元 / 百万 token）─────────────────────────────────────────
// 编译后的行：write 编译时缺省 = miss（官方 API 不单独报写入价）。

interface RateRow {
  /** 缓存命中输入单价 */
  hit: number
  /** 未命中输入单价 */
  miss: number
  /** 输出单价 */
  output: number
  /** 缓存写入单价，缺省 = miss */
  write: number
}

type Tier = 'peak' | 'offPeak'

/** 编译后的单模型条目。 */
interface RateEntry {
  /** 小写模型名，匹配 = 精确 → 后缀 */
  model: string
  /** 小写 provider 限定，null = 通配所有路由 */
  provider: string | null
  timezone: string
  /** 预格式化器：从事件时间戳取条目时区的星期与时分 */
  clock: Intl.DateTimeFormat
  kind: 'const' | 'peakvalley'
  /** 一口价行（kind = const） */
  flat?: RateRow
  /** 峰价行（kind = peakvalley） */
  peak?: RateRow
  /** 谷价行（kind = peakvalley） */
  valley?: RateRow
  /** 峰时段：星期几（0=周日）→ 升序 [startMin, endMin) 列表，编译时已校验不重叠 */
  peakMinutes?: Map<number, Array<[number, number]>>
  cacheSaving: string | number | null
}

const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const RANGE_PATTERN = /^(\d{1,2}):([0-5]\d)-(\d{1,2}):([0-5]\d)$/

const pricesShape = {
  hit: z.number().nonnegative(),
  miss: z.number().nonnegative(),
  output: z.number().nonnegative(),
  write: z.number().nonnegative().optional(),
}
const whenGroupSchema = z.object({
  days: z.array(z.string().min(1)).min(1),
  ranges: z.array(z.string().min(1)).min(1),
})
const entrySchema = z.object({
  model: z.string().min(1),
  provider: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  peak: z.object({ ...pricesShape, when: whenGroupSchema.array().min(1) }).optional(),
  valley: z.object(pricesShape).optional(),
  const: z.object(pricesShape).optional(),
  cacheSaving: z.union([z.string(), z.number()]).nullish(),
})
type RawEntry = z.infer<typeof entrySchema>
const ratesFileSchema = z.object({ models: z.array(entrySchema) })

/** 内置默认价目表（rates.yml 缺失/损坏时的兜底）：DeepSeek 官方 2026-08-17 峰谷刊例，周六日全天谷。 */
const RATE_DEFAULTS_RAW = {
  models: [
    {
      model: 'deepseek-v4-flash',
      timezone: 'Asia/Shanghai',
      peak: {
        hit: 0.1,
        miss: 3,
        output: 9,
        when: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], ranges: ['09:00-12:00', '14:00-18:00'] }],
      },
      valley: { hit: 0.05, miss: 1.5, output: 4.5 },
      cacheSaving: null,
    },
    {
      model: 'deepseek-v4-flash-vision-exp',
      timezone: 'Asia/Shanghai',
      peak: {
        hit: 0.1,
        miss: 3,
        output: 9,
        when: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], ranges: ['09:00-12:00', '14:00-18:00'] }],
      },
      valley: { hit: 0.05, miss: 1.5, output: 4.5 },
      cacheSaving: null,
    },
    {
      model: 'deepseek-v4-pro',
      timezone: 'Asia/Shanghai',
      peak: {
        hit: 0.3,
        miss: 9,
        output: 27,
        when: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], ranges: ['09:00-12:00', '14:00-18:00'] }],
      },
      valley: { hit: 0.15, miss: 4.5, output: 13.5 },
      cacheSaving: null,
    },
  ],
} satisfies z.infer<typeof ratesFileSchema>

const resolveRow = (p: { hit: number; miss: number; output: number; write?: number }): RateRow => ({
  hit: p.hit,
  miss: p.miss,
  output: p.output,
  write: p.write ?? p.miss,
})

/** 解析 "HH:MM-HH:MM" 为分钟区间，start 含、end 不含，end 允许 24:00，不支持跨天。 */
function parseRange(line: string): [number, number] {
  const m = RANGE_PATTERN.exec(line.trim())
  if (!m) throw new Error(`时段格式应为 "HH:MM-HH:MM"，收到 "${line}"`)
  const start = Number(m[1]) * 60 + Number(m[2])
  const end = Number(m[3]) * 60 + Number(m[4])
  if (Number(m[1]) > 24 || Number(m[3]) > 24 || end > 24 * 60) throw new Error(`时段越界：${line}`)
  if (start >= end) throw new Error(`时段起止倒挂或相等：${line}（不支持跨天，请拆成两条）`)
  return [start, end]
}

/** 原始条目 → 编译条目。任何问题都以 { ok:false, error } 返回，绝不抛出。 */
function compileEntry(raw: RawEntry, label: string): { ok: true; entry: RateEntry } | { ok: false; error: string } {
  try {
    const timezone = raw.timezone ?? 'Asia/Shanghai'
    // 时区有效性：Intl 不认的名字在这里直接抛，由 catch 转成跳过该条目
    const clock = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const base = {
      model: raw.model.toLowerCase(),
      provider: raw.provider ? raw.provider.toLowerCase() : null,
      timezone,
      clock,
      cacheSaving: raw.cacheSaving ?? null,
    }
    if (raw.const) {
      if (raw.peak || raw.valley) throw new Error('const 与 peak/valley 互斥，三选一')
      return { ok: true, entry: { ...base, kind: 'const', flat: resolveRow(raw.const) } }
    }
    if (!raw.peak) throw new Error('缺少计价形态：peak+valley 或 const 三选一')
    if (!raw.valley) throw new Error('peak 需要配套 valley（时段自动取补集，但谷价数字仍要写）')
    const peakMinutes = new Map<number, Array<[number, number]>>()
    for (const group of raw.peak.when) {
      for (const day of group.days) {
        const idx = DAY_INDEX[day.toLowerCase()]
        if (idx === undefined) throw new Error(`未知星期 "${day}"（可用 mon tue wed thu fri sat sun）`)
        const list = peakMinutes.get(idx) ?? []
        for (const line of group.ranges) {
          const [start, end] = parseRange(line)
          if (list.some(([s, e]) => start < e && s < end)) throw new Error(`峰时段与已有区间重叠：${line}`)
          list.push([start, end])
        }
        peakMinutes.set(idx, list.sort((a, b) => a[0] - b[0]))
      }
    }
    return {
      ok: true,
      entry: { ...base, kind: 'peakvalley', peak: resolveRow(raw.peak), valley: resolveRow(raw.valley), peakMinutes },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const DEFAULT_ENTRIES: RateEntry[] = ratesFileSchema
  .parse(RATE_DEFAULTS_RAW)
  .models.map((item, i) => {
    const r = compileEntry(item, `builtin #${i + 1}`)
    if (!r.ok) throw new Error(`内置默认价目表编译失败（编程错误）：${r.error}`)
    return r.entry
  })
/** 未知模型的估算兜底：永远用内置 flash 表，不随用户 rates.yml 增删而消失。 */
const FALLBACK_ENTRY = DEFAULT_ENTRIES.find((e) => e.model === 'deepseek-v4-flash')!

/** 读包根 rates.yml；缺失/损坏/全非法时回退内置默认表。任何异常都不外抛——手填文件绝不允许弄崩 host。 */
function loadRates(): { entries: RateEntry[]; source: 'rates.yml' | 'builtin' } {
  try {
    const file = fileURLToPath(new URL('../rates.yml', import.meta.url))
    const raw = ratesFileSchema.parse(parseYaml(readFileSync(file, 'utf8')))
    const entries: RateEntry[] = []
    raw.models.forEach((item, i) => {
      const r = compileEntry(item, `rates.yml #${i + 1}`)
      if (r.ok) entries.push(r.entry)
      else console.warn(`[meow-cachebilling] rates.yml 条目 ${i + 1}（${item.model}）已跳过：${r.error}`)
    })
    if (entries.length > 0) return { entries, source: 'rates.yml' }
    console.warn('[meow-cachebilling] rates.yml 没有有效条目，回退内置默认价目表')
  } catch (e) {
    console.warn(`[meow-cachebilling] rates.yml 读取失败，回退内置默认价目表：${e instanceof Error ? e.message : String(e)}`)
  }
  return { entries: DEFAULT_ENTRIES, source: 'builtin' }
}

const COMPILED = loadRates()

/** 条目时区的星期与分钟（h23 午夜=0；个别 ICU 午夜给 "24"，取模兜回 0）。 */
function localClock(clock: Intl.DateTimeFormat, timeMs: number): { day: number; minutes: number } {
  let day = -1
  let hour = 0
  let minute = 0
  for (const p of clock.formatToParts(new Date(timeMs))) {
    if (p.type === 'weekday') day = WEEKDAY_INDEX[p.value] ?? -1
    else if (p.type === 'hour') hour = Number(p.value) % 24
    else if (p.type === 'minute') minute = Number(p.value)
  }
  return { day, minutes: hour * 60 + minute }
}

function inPeak(entry: RateEntry, timeMs: number): boolean {
  const { day, minutes } = localClock(entry.clock, timeMs)
  const list = entry.peakMinutes?.get(day)
  if (!list) return false
  return list.some(([start, end]) => minutes >= start && minutes < end)
}

function lookupEntry(entries: RateEntry[], providerKey: string | null, key: string): RateEntry | null {
  // 先 provider 限定条目、再通配条目；每轮内部先精确、再后缀
  for (const preferProvider of [true, false]) {
    for (const exactPass of [true, false]) {
      for (const e of entries) {
        if (preferProvider ? e.provider !== providerKey : e.provider !== null) continue
        if (exactPass ? e.model === key : key.endsWith(e.model)) return e
      }
    }
  }
  return null
}

/** 模型在某时刻的费率行。未命中任何条目 → 按内置 flash 表的峰谷口径估算，matched=false 供客户端标注。 */
function rateOf(
  provider: string | null,
  model: string | null,
  timeMs: number,
): { row: RateRow; tier: Tier | null; matched: boolean } {
  const key = (model ?? '').toLowerCase()
  const providerKey = provider ? provider.toLowerCase() : null
  const entry = lookupEntry(COMPILED.entries, providerKey, key)
  if (entry === null) {
    const peak = inPeak(FALLBACK_ENTRY, timeMs)
    return { row: peak ? FALLBACK_ENTRY.peak! : FALLBACK_ENTRY.valley!, tier: peak ? 'peak' : 'offPeak', matched: false }
  }
  if (entry.kind === 'const') return { row: entry.flat!, tier: null, matched: true }
  const peak = inPeak(entry, timeMs)
  return { row: peak ? entry.peak! : entry.valley!, tier: peak ? 'peak' : 'offPeak', matched: true }
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
  const { row } = rateOf(sample.provider, sample.model, sample.time)
  return {
    hit: round9((sample.cacheReadTokens * row.hit) / 1e6),
    miss: round9((sample.inputTokens * row.miss + sample.cacheWriteTokens * row.write) / 1e6),
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
          /** 模型是否命中价目表；false 时金额为 flash 价估算，客户端标注「估算」 */
          priceMatched: z.boolean(),
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
              priceMatched: rateOf(state.provider, state.model, Date.now()).matched,
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
          const { row, tier, matched } = rateOf(s.provider, s.model, s.time)
          const cost = round9((s.cacheReadTokens * row.hit) / 1e6)
          const missCost = round9((s.inputTokens * row.miss + s.cacheWriteTokens * row.write) / 1e6)
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
            unitPricePerM: row.hit,
            priceMatched: matched,
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

/** 诊断口：node -e 里用固定时间戳验证价目表与峰谷判定，不进任何运行时路径。 */
export const _rates = { rateOf, loadRates }
