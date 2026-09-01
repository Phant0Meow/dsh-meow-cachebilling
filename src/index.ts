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
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import sz from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { defineDomain, domainTable, type KvTable } from '@deepseek-ai/dsh-storage-domain'

/** 插件名，与 cordis.patch.yml 的 name 一致，loader 诊断用。 */
export const name = 'meow-cachebilling'

/** 设置命名空间：预填层(rates.yml)之上的用户层住这里，与设置页卡片、手编 settings.yaml 三方共用。 */
const SETTINGS_NS = settingsNamespace('meow-cachebilling')

/** 必需服务：sessionProjections 由 @deepseek-ai/dsh-session-projection 提供，storageDomain 由 @deepseek-ai/dsh-storage-domain 提供（每步花费历史的落盘层），sessionPersistence 供旧记录迁移读日志。 */
export const inject = ['sessionProjections', 'storageDomain', 'sessionPersistence']

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
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const RANGE_PATTERN = /^(\d{1,2}):([0-5]\d)-(\d{1,2}):([0-5]\d)$/

/** 单个天 token → 星期下标列表：支持单天（mon）与区间（mon-fri，按周顺序前向展开，可跨周回到起点）。 */
function resolveDayDays(day: string): number[] {
  const p = day.toLowerCase()
  const span = /^([a-z]{3})-([a-z]{3})$/.exec(p)
  if (span) {
    const a = DAY_ORDER.indexOf(span[1])
    const b = DAY_ORDER.indexOf(span[2])
    if (a < 0 || b < 0) throw new Error(`未知星期 "${day}"（可用 mon tue wed thu fri sat sun）`)
    const out: number[] = []
    for (let i = a; ; i = (i + 1) % 7) {
      out.push(DAY_INDEX[DAY_ORDER[i]])
      if (i === b) break
    }
    return out
  }
  const idx = DAY_INDEX[p]
  if (idx === undefined) throw new Error(`未知星期 "${day}"（可用 mon tue wed thu fri sat sun，或 mon-fri 区间）`)
  return [idx]
}

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
        for (const idx of resolveDayDays(day)) {
          const list = peakMinutes.get(idx) ?? []
          for (const line of group.ranges) {
            const [start, end] = parseRange(line)
            if (list.some(([s, e]) => start < e && s < end)) throw new Error(`峰时段与已有区间重叠：${line}`)
            list.push([start, end])
          }
          peakMinutes.set(idx, list.sort((a, b) => a[0] - b[0]))
        }
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

/** 条目身份键："provider|model"（provider 缺省记 "*"）。预填层与用户层按它对齐覆盖关系。 */
const entryKey = (e: { model: string; provider?: string | null }): string =>
  `${(e.provider ?? '*').toLowerCase()}/${e.model.toLowerCase()}`

function compileMap(raw: Record<string, RawEntry>, label: string): Map<string, RateEntry> {
  const map = new Map<string, RateEntry>()
  for (const [key, item] of Object.entries(raw)) {
    const r = compileEntry(item, `${label} · ${key}`)
    if (r.ok) map.set(key, r.entry)
    else console.warn(`[meow-cachebilling] ${label} 条目 ${key} 已跳过：${r.error}`)
  }
  return map
}

/** 预填层原始条目：包根 rates.yml（缺失/损坏回退内置默认表）。任何异常都不外抛——手填文件绝不允许弄崩 host。 */
const PREFILL_RAW: Record<string, RawEntry> = (() => {
  try {
    const file = fileURLToPath(new URL('../rates.yml', import.meta.url))
    const models = ratesFileSchema.parse(parseYaml(readFileSync(file, 'utf8'))).models
    console.log(`[meow-cachebilling] 预填价目表已加载：rates.yml ${models.length} 条`)
    return Object.fromEntries(models.map((e) => [entryKey(e), e]))
  } catch (e) {
    console.warn(`[meow-cachebilling] rates.yml 读取失败，回退内置默认价目表：${e instanceof Error ? e.message : String(e)}`)
    return Object.fromEntries(RATE_DEFAULTS_RAW.models.map((e) => [entryKey(e), e]))
  }
})()

/** 预填层编译产物（rates.yml 或默认表，启动时定，随发版更新）。 */
const COMPILED_PREFILL: Map<string, RateEntry> = compileMap(PREFILL_RAW, '预填')

/** 合成层：base(预填) ⊕ user(settings) 在 field 级覆盖；rateOf 只查这张。 */
let mergedEntries: RateEntry[] = Array.from(COMPILED_PREFILL.values())

/** 从合成值重编译。单条坏条目回落预填值，绝不因手编 settings.yaml 让账单哑火。 */
function recompileMerged(composed: unknown): void {
  const raw = composed as Record<string, RawEntry> | null | undefined
  const keys = raw ? Object.keys(raw) : []
  if (keys.length === 0) {
    mergedEntries = Array.from(COMPILED_PREFILL.values())
    return
  }
  const map = new Map<string, RateEntry>()
  for (const key of keys) {
    const r = compileEntry(raw![key] as RawEntry, `settings · ${key}`)
    if (r.ok) {
      map.set(key, r.entry)
    } else {
      const fallback = COMPILED_PREFILL.get(key)
      if (fallback) {
        map.set(key, fallback)
        console.warn(`[meow-cachebilling] settings 条目 ${key} 已跳过（回落预填）：${r.error}`)
      } else {
        console.warn(`[meow-cachebilling] settings 条目 ${key} 已跳过：${r.error}`)
      }
    }
  }
  if (map.size > 0) mergedEntries = Array.from(map.values())
}

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
  const entry = lookupEntry(mergedEntries, providerKey, key)
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

/** 按样本模型与事件时刻计算一轮三笔费用＋计价判定，元，round9 防精度漂移。 */
function computeCosts(sample: Sample): {
  hit: number
  miss: number
  output: number
  tier: Tier | null
  matched: boolean
} {
  const { row, tier, matched } = rateOf(sample.provider, sample.model, sample.time)
  return {
    hit: round9((sample.cacheReadTokens * row.hit) / 1e6),
    miss: round9((sample.inputTokens * row.miss + sample.cacheWriteTokens * row.write) / 1e6),
    output: round9((sample.outputTokens * row.output) / 1e6),
    tier,
    matched,
  }
}

function costOf(sample: Sample): { hit: number; miss: number; output: number } {
  const c = computeCosts(sample)
  return { hit: c.hit, miss: c.miss, output: c.output }
}

// ── 每步花费历史（曲线块的数据底座）─────────────────────────────────────
// 猫猫拍板（2026-08-31）：①只存命中价目表的步——估算步是假数据，一步都不入库；
// ②模型标签只在换模型/换峰谷的那一步打一条，后续步沿用，省存储；
// ③平均曲线只纳入最近 30 天的会话；④峰谷分开当两个模型算。

/** 平均参与窗口：最近 30 天。 */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** 主线会话判定：DSH core 给主线会话发 `session-*` id；原生子代理是裸 UUID（SessionId(randomUUID())），femwa 投影窗等第三方衍生会话各有前缀。
 * 曲线统计只认主线会话——子代理与投影窗的每步模式不可比（猫猫：子代理和 proj 窗都不要算）。 */
function isWindowSessionId(id: string): boolean {
  return id.startsWith('session-')
}

/** 记录键 → 会话 id（剥掉换代后缀 `#n`）。 */
function baseSessionId(recordId: string): string {
  return recordId.includes('#') ? recordId.slice(0, recordId.lastIndexOf('#')) : recordId
}

/** 模型键："provider/model/tierWord"，峰谷分开当两个模型（tierWord: peak|valley|const）。 */
function historyKey(provider: string, model: string, tier: Tier | null): string {
  const word = tier === 'peak' ? 'peak' : tier === 'offPeak' ? 'valley' : 'const'
  return `${provider.toLowerCase()}/${model.toLowerCase()}/${word}`
}

/** 单条精确步目：n=会话内第几次 API 调用（估算步也计数，只是不入库），t/s=turn/step，c=该步花费（元），m=模型键。 */
interface HistoryStep {
  n: number
  t: number
  s: number
  c: number
  m: string
}

const historyRecordSchema = z.object({
  createdAt: z.number(),
  updatedAt: z.number(),
  steps: z.array(
    z.object({
      n: z.number().int().min(1),
      t: z.number().int(),
      s: z.number().int(),
      c: z.number().nonnegative(),
    }),
  ),
  marks: z.record(z.string(), z.string()),
  /** 历史代数；v6 时代的旧记录无此字段（迁移的目标特征） */
  gen: z.number().int().nonnegative().optional(),
})

type HistoryRecord = z.infer<typeof historyRecordSchema>

/** 跨会话历史域：走官方存储层，落成 DSH home 下的 meow_cachebilling.json（与 workspace.json 同层）。 */
const historyDomain = defineDomain({
  name: 'meow_cachebilling',
  version: 1,
  tables: { sessions: domainTable(historyRecordSchema) },
})

let historyTable: KvTable<string, HistoryRecord> | null = null
let historyVersion = 0

/** 折叠换模型标签：首条必打，之后仅换键时打——存储体积对齐猫猫的省空间格式。 */
function deriveMarks(steps: HistoryStep[]): Record<string, string> {
  const marks: Record<string, string> = {}
  let prev: string | null = null
  for (const step of steps) {
    if (prev === null || step.m !== prev) marks[String(step.n)] = step.m
    prev = step.m
  }
  return marks
}

/** 精确步入史：同一 n 覆盖（流式替换语义），新 n 追加。 */
function upsertHistory(history: HistoryStep[], entry: HistoryStep): HistoryStep[] {
  const idx = history.findIndex((e) => e.n === entry.n)
  if (idx >= 0) {
    const next = history.slice()
    next[idx] = entry
    return next
  }
  return [...history, entry]
}

/** API 调用计数：同一 (turn,step) 沿用 n（流式替换），新调用加一——估算步也计数，只是不入库。 */
function nextCall(
  call: { t: number; s: number; n: number } | null,
  t: number,
  s: number,
): { t: number; s: number; n: number } {
  if (call !== null && call.t === t && call.s === s) return call
  return { t, s, n: (call?.n ?? 0) + 1 }
}

let curveCache: { version: number; key: string; result: { avg: number[]; sessions: number } } | null =
  null

/** 当前模型键的平均累计曲线：每步取「该步有它的所有会话」的平均增量再累加；x 轴保留到最远样本步（不可截断），无样本步平走；30 天外的会话不参与。结果按（键，落盘版本）缓存。 */
function averageCurve(key: string): { avg: number[]; sessions: number } {
  if (curveCache !== null && curveCache.version === historyVersion && curveCache.key === key) {
    return curveCache.result
  }
  const empty = { avg: [] as number[], sessions: 0 }
  if (historyTable === null) {
    curveCache = { version: historyVersion, key, result: empty }
    return empty
  }
  const now = Date.now()
  let maxN = 0
  let sessions = 0
  const buckets = new Map<number, { sum: number; count: number }>()
  for (const [recordId, record] of historyTable.entries()) {
    if (!isWindowSessionId(baseSessionId(recordId))) continue
    if (now - record.updatedAt > RETENTION_MS) continue
    let current = ''
    let hit = false
    for (const step of record.steps) {
      const mark = record.marks[String(step.n)]
      if (mark !== undefined) current = mark
      if (current !== key) continue
      hit = true
      if (step.n > maxN) maxN = step.n
      const bucket = buckets.get(step.n) ?? { sum: 0, count: 0 }
      bucket.sum += step.c
      bucket.count += 1
      buckets.set(step.n, bucket)
    }
    if (hit) sessions += 1
  }
  let result = empty
  if (maxN > 0) {
    const avg: number[] = []
    let cum = 0
    for (let k = 1; k <= maxN; k++) {
      const bucket = buckets.get(k)
      if (bucket !== undefined) cum += bucket.sum / bucket.count
      avg.push(round9(cum))
    }
    result = { avg, sessions }
  }
  curveCache = { version: historyVersion, key, result }
  return result
}

/** 曲线块视图数据：key=当前模型键，sessions=平均参与会话数，avg=平均累计（步 1..N 稠密），cur=本会话实际累计 [[n, 累计]...]（全部精确步，含换模型前的步——钱包真实轨迹）。 */
interface CurveView {
  key: string
  sessions: number
  avg: number[]
  cur: Array<[number, number]>
}

function buildCurve(state: ProjectionState, tier: Tier | null, matched: boolean): CurveView | null {
  const s = state.last
  if (s === null || !matched || s.provider === null || s.model === null) return null
  const key = historyKey(s.provider, s.model, tier)
  const { avg, sessions } = averageCurve(key)
  let cum = 0
  const cur = state.history.map((e): [number, number] => {
    cum = round9(cum + e.c)
    return [e.n, cum]
  })
  if (avg.length === 0 && cur.length === 0) return null
  return { key, sessions, avg, cur }
}

/** 历史落盘：投影 state.history 是唯一事实（重放可重建），这里只做搬运——usage 事件防抖 2s，turn/end 与会话关闭即写，写失败仅警告。
 * 压缩换代后双记录：当前代写 `会话id#gen`（gen 0 沿用裸会话 id，与旧记录兼容），上一代归档写成独立样本（内容 immutable，写一次即可）。 */
function installHistoryRecorder(ctx: any, table: KvTable<string, HistoryRecord>): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const archivedFlushed = new Map<string, number>()
  const flush = (session: any): void => {
    try {
      // 子代理（裸 UUID）与投影窗（fem-proj-* 等）不入史：每步模式与主线会话不可比
      if (!isWindowSessionId(String(session.id))) return
      const state = ctx.sessionProjections.stateOf(session, 'cacheBilling') as
        | ProjectionState
        | undefined
      if (state === undefined) return
      const createdAt =
        typeof session.header?.createdAt === 'number' ? session.header.createdAt : Date.now()
      const warn = (what: string, e: unknown): void => {
        console.warn(`[meow-cachebilling] 历史落盘失败（不影响账单）：${what}`, e)
      }
      const gen = state.gen
      const recordId = gen === 0 ? String(session.id) : `${session.id}#${gen}`
      if (state.history.length > 0) {
        const record: HistoryRecord = {
          createdAt,
          updatedAt: Date.now(),
          steps: state.history.map((e) => ({ n: e.n, t: e.t, s: e.s, c: e.c })),
          marks: deriveMarks(state.history),
          gen,
        }
        table
          .put(recordId, record)
          .then(() => {
            historyVersion += 1
          })
          .catch((e: unknown) => {
            warn(recordId, e)
          })
      }
      const archive = state.prevGen
      if (
        archive !== null &&
        archive.steps.length > 0 &&
        (archivedFlushed.get(String(session.id)) ?? -1) < archive.gen
      ) {
        const archiveId =
          archive.gen === 0 ? String(session.id) : `${session.id}#${archive.gen}`
        const archiveRecord: HistoryRecord = {
          createdAt,
          updatedAt: archive.updatedAt,
          steps: archive.steps.map((e) => ({ ...e })),
          marks: { ...archive.marks },
          gen: archive.gen,
        }
        table
          .put(archiveId, archiveRecord)
          .then(() => {
            archivedFlushed.set(String(session.id), archive.gen)
            historyVersion += 1
          })
          .catch((e: unknown) => {
            warn(archiveId, e)
          })
      }
    } catch (e) {
      console.warn('[meow-cachebilling] 历史读取失败（不影响账单）：', e)
    }
  }
  ctx.on('session/event', (session: any, event: any) => {
    // 子代理/投影窗不监听不落盘
    if (!isWindowSessionId(String(session.id))) return
    // 压缩提交即写归档：手动压缩发生在 turn 之间，没有随后的 turn/end，不等防抖
    if (event.type === 'compaction/summary') {
      flush(session)
      return
    }
    if (event.type === 'turn/end') {
      const pending = timers.get(session.id)
      if (pending !== undefined) {
        clearTimeout(pending)
        timers.delete(session.id)
      }
      flush(session)
      return
    }
    const usage =
      (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') ||
      (event.type === 'assistant/message' && event.data?.usage !== undefined)
    if (!usage || timers.has(session.id)) return
    timers.set(
      session.id,
      setTimeout(() => {
        timers.delete(session.id)
        flush(session)
      }, 2000),
    )
  })
  ctx.on('session/disposed', (session: any) => {
    const pending = timers.get(session.id)
    if (pending !== undefined) {
      clearTimeout(pending)
      timers.delete(session.id)
    }
    flush(session)
  })
  ctx.effect(
    () => () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
    'meow-cachebilling.historyTimers',
  )
}

/** 旧记录一次性迁移：v6 时代写入的记录（无 gen 字段）不带换代语义，压缩点前后两段连记在一条里。
 * 用官方 restore 全量重放该会话日志拿到换代后的 state，把旧记录拆成「上一代归档 + 当前代」两条；
 * 无压缩的干净记录只补 gen 标记。逐条 fail-soft，失败保留原样下次启动重试（日志有 compaction/summary 才拆）。 */
async function migrateLegacyRecords(ctx: any, table: KvTable<string, HistoryRecord>): Promise<void> {
  const targets: Array<{ id: string; record: HistoryRecord }> = []
  for (const [id, record] of table.entries()) {
    if (record.gen !== undefined) continue
    targets.push({ id, record })
  }
  if (targets.length === 0) return
  let migrated = 0
  for (const { id, record } of targets) {
    try {
      const baseId = baseSessionId(id)
      if (!isWindowSessionId(baseId)) {
        // 子代理/投影窗：不参与统计，补 gen 戳停止重试即可，不必读日志
        if (record.gen !== 0) {
          await table.put(id, { ...record, gen: 0 })
          historyVersion += 1
        }
        migrated += 1
        continue
      }
      const log = await ctx.sessionPersistence.readFrom(baseId, 0)
      const events: any[] = log?.events ?? []
      if (!events.some((e) => e.type === 'compaction/summary')) {
        // 无压缩：干净单段，补 gen 标记即可
        if (record.gen !== 0) {
          await table.put(id, { ...record, gen: 0 })
          historyVersion += 1
        }
        migrated += 1
        continue
      }
      const restored = ctx.sessionProjections.restore({}, events, 0)
      const state = restored?.checkpoint?.rows?.cacheBilling?.val as ProjectionState | undefined
      if (state === undefined) throw new Error('restore 未产出 cacheBilling 状态')
      if (state.prevGen !== null && state.prevGen.steps.length > 0) {
        const archiveId = state.prevGen.gen === 0 ? baseId : `${baseId}#${state.prevGen.gen}`
        await table.put(archiveId, {
          createdAt: record.createdAt,
          updatedAt: state.prevGen.updatedAt,
          steps: state.prevGen.steps,
          marks: state.prevGen.marks,
          gen: state.prevGen.gen,
        })
      }
      if (state.history.length > 0) {
        const currentId = state.gen === 0 ? baseId : `${baseId}#${state.gen}`
        await table.put(currentId, {
          createdAt: record.createdAt,
          updatedAt: Date.now(),
          steps: state.history.map((e) => ({ n: e.n, t: e.t, s: e.s, c: e.c })),
          marks: deriveMarks(state.history),
          gen: state.gen,
        })
      }
      // 多代压缩的旧记录：日志里只能恢复出最后两段，裸 id 上残留的合并段以空记录占位（聚合跳过空段），不再污染平均
      if (state.gen >= 2) {
        await table.put(baseId, {
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          steps: [],
          marks: {},
          gen: 0,
        })
      }
      historyVersion += 1
      migrated += 1
      console.log(`[meow-cachebilling] 旧记录已按压缩换代拆分：${id}（gen ${state.gen}）`)
    } catch (e) {
      console.warn(`[meow-cachebilling] 旧记录迁移失败（保留原样，下次启动重试）：${id}`, e)
    }
  }
  console.log(`[meow-cachebilling] 历史记录迁移完成：${migrated}/${targets.length}`)
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
  /** API 调用计数（估算步也计数，只是不入史）：t/s=turn/step，n=会话内第几次调用 */
  call: { t: number; s: number; n: number } | null
  /** 每步精确花费历史（只存命中价目表的步），曲线块数据源，重放可重建 */
  history: HistoryStep[]
  /** 历史代数：compaction/summary 提交即换代，压缩后的步从头计 */
  gen: number
  /** 上一代的归档段（压缩换代时的快照），录盘器把它写成独立样本记录 */
  prevGen: {
    gen: number
    updatedAt: number
    steps: Array<{ n: number; t: number; s: number; c: number }>
    marks: Record<string, string>
  } | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: any, _config: any): void {
  ctx.inject(['sessionProjections'], (projectionCtx: any) => {
    // 新版 0.1.1-rc.2 契约：{ key, stateSchema, init, apply, wire: {viewSchema, view}, stateVersion }
    // 没有 wire 即 host-only 单元，状态不进客户端快照，useProjection 永远拿不到值。
    projectionCtx.sessionProjections.register({
      key: 'cacheBilling',
      // v7：state.gen/prevGen 增加压缩换代——compaction/summary 时老步归档为独立样本（记录键 #gen），步数从头计；旧持久化行作废重放
      stateVersion: 7,
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
        call: z
          .object({
            t: z.number().int(),
            s: z.number().int(),
            n: z.number().int().min(1),
          })
          .nullable(),
        history: z.array(
          z.object({
            n: z.number().int().min(1),
            t: z.number().int(),
            s: z.number().int(),
            c: z.number().nonnegative(),
            m: z.string().min(1),
          }),
        ),
        gen: z.number().int().nonnegative(),
        prevGen: z
          .object({
            gen: z.number().int().nonnegative(),
            updatedAt: z.number(),
            steps: z.array(
              z.object({
                n: z.number().int().min(1),
                t: z.number().int(),
                s: z.number().int(),
                c: z.number().nonnegative(),
              }),
            ),
            marks: z.record(z.string(), z.string()),
          })
          .nullable(),
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
        call: null,
        history: [],
        gen: 0,
        prevGen: null,
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

        // 压缩提交点（compaction/summary 才算数，start/end 只是括号、失败路径无 summary）：表层被摘要替换，
        // 历史语义换代——已有精确步归档为上一代独立样本（录盘器写成 `会话id#gen` 记录），步数从头计。
        // 摘要器自身的 usage 在 summary 事件载荷里、不走 turn/step usage，不会混进每步历史。
        if (event.type === 'compaction/summary') {
          return {
            ...state,
            gen: state.gen + 1,
            prevGen:
              state.history.length > 0
                ? {
                    gen: state.gen,
                    updatedAt: typeof event.time === 'number' ? event.time : Date.now(),
                    steps: state.history.map(({ n, t, s, c }) => ({ n, t, s, c })),
                    marks: deriveMarks(state.history),
                  }
                : state.prevGen,
            call: null,
            history: [],
          }
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
        const billed = computeCosts(sample)
        const current = { hit: billed.hit, miss: billed.miss, output: billed.output }
        const writeMiss = isWriteMiss(sample)
        const fullMiss = isFullMiss(sample)
        const sampleInputTokens = sample.inputTokens + sample.cacheReadTokens + sample.cacheWriteTokens
        // 每步花费入史：只存命中价目表的步（估算步是假数据，不入库），n 按调用计数（估算步也计数）
        const call = nextCall(state.call, turn, step)
        const history =
          billed.matched && sample.provider !== null && sample.model !== null
            ? upsertHistory(state.history, {
                n: call.n,
                t: turn,
                s: step,
                c: round9(billed.hit + billed.miss + billed.output),
                m: historyKey(sample.provider, sample.model, billed.tier),
              })
            : state.history
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
            call,
            history,
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
          call,
          history,
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
          /** 曲线块（第二块）：当前模型键的平均累计曲线 + 本会话实际累计；null = 当前模型未命中价目表（估算步不入曲线） */
          curve: z
            .object({
              key: z.string(),
              sessions: z.number().int().nonnegative(),
              avg: z.array(z.number()),
              cur: z.array(z.tuple([z.number().int(), z.number()])),
            })
            .nullable(),
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
              curve: null,
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
            curve: buildCurve(state, tier, matched),
          }
        },
      },
    })
  })

  // ── 设置命名空间：双层价目表的用户层 ──
  // base = 预填层（rates.yml），user = 设置页/手编 settings.yaml；field 级覆盖，unset 回落预填。
  // scope.watch → onChange → 重编译合成层：设置页改价目即时生效，无需重启。
  let currentGetter: () => unknown = (): unknown => PREFILL_RAW
  const recompile = (): void => {
    recompileMerged(currentGetter())
  }
  try {
    installSettingsSection(ctx, SETTINGS_NS, sz.dict(sz.any()), PREFILL_RAW, {
      // RPC 写入的严格校验：任何一条编不过就拒写（手编 settings.yaml 不走这里，由 recompile 防御性回落兜底）
      validate: (value: unknown): void => {
        for (const [key, item] of Object.entries(value as Record<string, RawEntry>)) {
          const r = compileEntry(item as RawEntry, `settings · ${key}`)
          if (!r.ok) throw new Error(`条目 ${key}：${r.error}`)
        }
      },
      setSource: (get: () => unknown): void => {
        currentGetter = get
      },
      onChange: (): void => {
        recompile()
      },
    })
  } catch (e) {
    console.warn('[meow-cachebilling] 设置命名空间注册失败（账单继续使用预填层）：', e)
  }

  // ── 每步花费历史：开域 + 录盘（曲线块的数据底座，失败只降级不炸）──
  ctx.storageDomain
    .open(historyDomain)
    .then((domain: any) => {
      const table = domain.table('sessions') as KvTable<string, HistoryRecord>
      historyTable = table
      ctx.effect(
        () => () => {
          historyTable = null
          void domain.close()
        },
        'meow-cachebilling.historyDomain',
      )
      installHistoryRecorder(ctx, table)
      // 旧记录迁移（v6 时代的压缩两段连记 → 按日志里的 compaction/summary 拆代），逐条 fail-soft
      void migrateLegacyRecords(ctx, table)
      console.log('[meow-cachebilling] 历史域已打开：meow_cachebilling')
    })
    .catch((e: unknown) => {
      console.warn('[meow-cachebilling] 历史域打开失败（曲线块降级，账单不受影响）：', e)
    })
}

/** 诊断口：node -e 里用固定时间戳验证价目表与峰谷判定，不进任何运行时路径。 */
export const _rates = { rateOf, mergedEntries: (): RateEntry[] => mergedEntries, PREFILL_RAW }
