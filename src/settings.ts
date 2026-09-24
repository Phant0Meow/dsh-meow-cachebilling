/**
 * meow-cachebilling — 设置页模块（喵缓存账单）。
 *
 * 独立模块：只管设置页的显示与读写，不掺和账单渲染；由 client.ts 引入（一行 applySettings(ctx)，失败仅警告不影响账单）。
 * 形态：设置页顶级分区（settings.section，与「通用」「模型」「插件」平级的独立标签页）。
 * 2026-08-30 猫猫拍板「我们需要在设置加个标签页，不是把信息加到别人的标签页里」——由旧形态（settings.plugin.item 卡片，住在官方插件 tab）升级而来。
 * 2026-09-10 价目条目按 provider 分组展示：组头 = 供应商名 + 条目数 + 组内「添加」（provider 预填该组），行内只报模型名。
 * 2026-09-10 模型/供应商输入框挂 datalist：进设置页 + 每次开编辑器扫一遍 DSH 会话模型目录（sessions.models，
 *           settings+预置合并后的最终目录，借用模型选择器的同一份 RPC）；模型唯一命中供应商时自动带出 provider。
 * 2026-09-14 时区判断三处合一：显示（tzFor）/ 校验（validateDraft）/ 落盘（buildEntry）共用 autoTzOf 查同一张
 *           内置表——预设 provider 的峰谷条目时区由表带出，输入框隐藏时不再强校验手填时区（修「时区输入框不
 *           出现就永远保存不了」；空串也绝不落盘，host schema min(1) 会拒）。
 * 契约照官方 settings.section（ui-settings-general / ui-settings-models 同款）：
 *   - host 半身（index.ts）用 installSettingsSection 注册命名空间 meow-cachebilling，base = 包根 rates.yml 预填层（不变）
 *   - 浏览器半身挂 settings.section（list slot：id + order + label），整页渲染价目表
 *   - 快照三视图：value(合成) / base(预填) / user(用户覆盖)；scope.set(field, value) 写用户层、scope.unset(field) 清回预填
 *   - 双层语义：key 存在于 user 层即覆盖预填条目；「恢复预填」= unset；自定义条目删除 = unset
 *   - host 端 scope.watch → onChange → 重编译合成层：设置页改价目即时生效，无需重启
 */

import * as React from 'react'
import { PREFILL_RATES } from './prefill.gen'

const SETTINGS_NS = 'meow-cachebilling'
const CSS_ID = 'meow-cachebilling-settings-css'

const CSS = `
.meowcb_set_card{color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:8px}
.meowcb_set_intro{color:var(--dsw-alias-label-caption);font-size:12px;line-height:1.6;margin:0}
.meowcb_set_row{align-items:center;background:color-mix(in srgb,currentColor 4%,transparent);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;cursor:pointer;display:flex;gap:8px;padding:8px 10px}
.meowcb_set_row:hover{border-color:var(--dsw-alias-border-l2)}
.meowcb_set_badge{border-radius:999px;font-size:11px;line-height:16px;padding:0 8px}
.meowcb_set_badge_prefill{background:color-mix(in srgb,#60a5fa 18%,transparent);color:#60a5fa}
.meowcb_set_badge_override{background:color-mix(in srgb,#f59e0b 18%,transparent);color:#f59e0b}
.meowcb_set_badge_custom{background:color-mix(in srgb,#34d399 18%,transparent);color:#34d399}
.meowcb_set_editor{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:flex;flex-direction:column;gap:8px;padding:12px}
.meowcb_set_line{align-items:center;display:flex;gap:8px;flex-wrap:wrap}
.meowcb_set_label{color:var(--dsw-alias-label-secondary);font-size:12px;flex:none}
.meowcb_set_input{background:transparent;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;color:inherit;font-size:13px;padding:4px 8px}
.meowcb_set_input_num{width:64px}
.meowcb_set_input_time{flex:1;min-width:200px;font-family:ui-monospace,monospace}
.meowcb_set_input_grow{flex:1;min-width:80px}
.meowcb_set_input_save{width:112px}
.meowcb_set_price{align-items:center;display:flex;gap:4px;flex:none}
.meowcb_set_check{align-items:center;cursor:pointer;display:flex;gap:4px;flex:none}
.meowcb_set_input_err{border-color:#f43f5e}
.meowcb_set_err{color:#f43f5e;font-size:12px;line-height:1.5;margin:0;white-space:pre-wrap}
.meowcb_set_actions{display:flex;gap:8px;margin-top:2px}
.meowcb_set_muted{color:var(--dsw-alias-label-caption);font-size:12px}
.meowcb_set_section{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;margin-top:4px}
.meowcb_set_block{display:flex;flex-direction:column;gap:8px}
.meowcb_set_group{align-items:center;display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.meowcb_set_group::before{background:var(--dsw-alias-border-l2);border-radius:2px;content:'';height:12px;width:3px}
.meowcb_set_group_name{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
.meowcb_set_group_count{background:color-mix(in srgb,currentColor 10%,transparent);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;padding:0 8px}
.meowcb_set_group_add{cursor:pointer;font-size:12px;margin-left:auto;padding:2px 12px}
.meowcb_set_group_add:hover{border-color:var(--dsw-alias-border-l2)}
.meowcb_set_items{display:flex;flex-direction:column;gap:8px;margin-left:14px}
.meowcb_set_tier{font-weight:600}
.meowcb_set_title{font-size:16px;font-weight:600;margin:0}
.meowcb_set_subtitle{color:var(--dsw-alias-label-caption);font-size:12px;line-height:1.6;margin:0}
.meowcb_set_page{color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:10px;max-width:760px;padding:4px 0}
`

// ── 类型与工具 ──────────────────────────────────────────────────────────────

interface WhenGroup {
  days: string[]
  ranges: string[]
}
interface PricePart {
  hit: number
  miss: number
  output: number
  write?: number
}
interface UserEntry {
  model: string
  provider?: string
  timezone?: string
  peak?: PricePart & { when: WhenGroup[] }
  valley?: PricePart
  const?: PricePart
  cacheSaving?: string | number | null
}
type EntryMap = Record<string, UserEntry>

/** provider → 计费方账单时区自动选表（后台没数据才让用户手填）。 */
const PROVIDER_TIMEZONE: Record<string, string> = {
  'deepseek-official': 'Asia/Shanghai',
  deepseek: 'Asia/Shanghai',
  zhipu: 'Asia/Shanghai',
  'zai-coding-cn': 'Asia/Shanghai',
  zai: 'Asia/Shanghai',
  bigmodel: 'Asia/Shanghai',
  siliconflow: 'Asia/Shanghai',
  moonshot: 'Asia/Shanghai',
  alibaba: 'Asia/Shanghai',
  openrouter: 'UTC',
  openai: 'UTC',
  anthropic: 'UTC',
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const RANGE_PATTERN = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/

/** provider 命中内置表 → 返回计费时区；否则 null（= 时区输入框需要出现、峰谷条目需要手填）。 */
function autoTzOf(provider: string): string | null {
  return PROVIDER_TIMEZONE[provider.trim().toLowerCase()] ?? null
}

/** 矩阵语法 → when 组：[mon-fri][09:00-12:00, 14:00-18:00] + [sat, sun][00:00-24:00] */
function parseWhenText(text: string): WhenGroup[] {
  const out: WhenGroup[] = []
  for (const g of text.split('+')) {
    const m = /^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*$/.exec(g)
    if (!m) throw new Error(`每组应为 [天数][时段列表]，收到 "${g.trim() || '（空）'}"`)
    const days: string[] = []
    for (const part of m[1].split(/[,，]/)) {
      const p = part.trim().toLowerCase()
      if (!p) continue
      const span = /^([a-z]{3})-([a-z]{3})$/.exec(p)
      if (span) {
        const a = DAY_ORDER.indexOf(span[1])
        const b = DAY_ORDER.indexOf(span[2])
        if (a < 0 || b < 0) throw new Error(`未知星期 "${p}"（可用 mon tue wed thu fri sat sun）`)
        for (let i = a; ; i = (i + 1) % 7) {
          days.push(DAY_ORDER[i])
          if (i === b) break
        }
      } else {
        if (DAY_ORDER.indexOf(p) < 0) throw new Error(`未知星期 "${p}"`)
        days.push(p)
      }
    }
    const ranges = m[2]
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (days.length === 0) throw new Error('天数为空')
    for (const r of ranges) {
      if (!RANGE_PATTERN.test(r)) throw new Error(`时段格式应为 "HH:MM-HH:MM"，收到 "${r}"`)
    }
    if (ranges.length === 0) throw new Error('时段为空')
    out.push({ days, ranges })
  }
  if (out.length === 0) throw new Error('峰时段为空')
  return out
}

/** when 组 → 矩阵语法（编辑回显用）。 */
function serializeWhen(groups: WhenGroup[]): string {
  return groups.map((g) => `[${g.days.join(',')}][${g.ranges.join(', ')}]`).join(' + ')
}

const entryKey = (e: { model: string; provider?: string }): string =>
  `${(e.provider ?? '*').toLowerCase()}/${e.model.trim().toLowerCase()}`

const toNum = (v: string): number => Number(v.trim())

// ── DSH 模型目录（设置页输入框的下拉候选）───────────────────────────────────

/** 会话模型目录里的一条：provider=路由 id（与价目表 provider 同一命名空间），model=API 模型 id。 */
interface CatalogModel {
  provider: string
  model: string
}

const MODEL_DATALIST_ID = 'meowcb-model-catalog'
const PROVIDER_DATALIST_ID = 'meowcb-provider-catalog'

/** 模型 id 在目录里命中的唯一供应商（大小写不敏感精确匹配；多供应商共用同 id 时不猜）。 */
function uniqueProviderFor(model: string, catalog: CatalogModel[] | null): string | null {
  const needle = model.trim().toLowerCase()
  if (!needle || !catalog) return null
  let hit: string | null = null
  for (const row of catalog) {
    if (row.model.toLowerCase() !== needle) continue
    if (hit !== null && hit !== row.provider) return null
    hit = row.provider
  }
  return hit
}

/** 目录 groups（provider 分组）→ 扁平候选表。 */
function groupsToRows(groups: ReadonlyArray<{ id?: string; models?: ReadonlyArray<{ id?: string }> }> | undefined): CatalogModel[] {
  const out: CatalogModel[] = []
  for (const g of groups ?? []) {
    for (const m of g.models ?? []) {
      if (g.id && m.id) out.push({ provider: g.id, model: m.id })
    }
  }
  return out
}

// ── 编辑草稿 ────────────────────────────────────────────────────────────────

interface Draft {
  provider: string
  model: string
  timezone: string
  isPeak: boolean
  flatHit: string
  flatMiss: string
  flatOutput: string
  peakHit: string
  peakMiss: string
  peakOutput: string
  whenText: string
  valleyHit: string
  valleyMiss: string
  valleyOutput: string
  cacheSaving: string
}

const NUM = '0'
function draftFromEntry(e: UserEntry): Draft {
  return {
    provider: e.provider ?? '',
    model: e.model ?? '',
    timezone: e.timezone ?? '',
    isPeak: Boolean(e.peak),
    flatHit: e.const ? String(e.const.hit) : NUM,
    flatMiss: e.const ? String(e.const.miss) : NUM,
    flatOutput: e.const ? String(e.const.output) : NUM,
    peakHit: e.peak ? String(e.peak.hit) : NUM,
    peakMiss: e.peak ? String(e.peak.miss) : NUM,
    peakOutput: e.peak ? String(e.peak.output) : NUM,
    whenText: e.peak ? serializeWhen(e.peak.when) : '[mon-fri][09:00-12:00, 14:00-18:00]',
    valleyHit: e.valley ? String(e.valley.hit) : NUM,
    valleyMiss: e.valley ? String(e.valley.miss) : NUM,
    valleyOutput: e.valley ? String(e.valley.output) : NUM,
    cacheSaving: e.cacheSaving == null ? '' : String(e.cacheSaving),
  }
}
const emptyDraft = (): Draft => ({
  provider: '',
  model: '',
  timezone: '',
  isPeak: false,
  flatHit: NUM,
  flatMiss: NUM,
  flatOutput: NUM,
  peakHit: NUM,
  peakMiss: NUM,
  peakOutput: NUM,
  whenText: '[mon-fri][09:00-12:00, 14:00-18:00]',
  valleyHit: NUM,
  valleyMiss: NUM,
  valleyOutput: NUM,
  cacheSaving: '',
})

/** 保存前校验：返回错误文案或 null。价格必须是非负数字；峰谷必须配齐时间与时区（一口价不需要时区）。 */
function validateDraft(d: Draft): string | null {
  if (!d.model.trim()) return '模型不能为空'
  const numOk = (v: string): boolean => v.trim() !== '' && Number.isFinite(toNum(v)) && toNum(v) >= 0
  const partOk = (hit: string, miss: string, output: string): string | null => {
    if (!numOk(hit) || !numOk(miss) || !numOk(output)) return '价格必须是非负数字（元 / 百万 token）'
    return null
  }
  if (d.isPeak) {
    // 与 tzFor 用同一张表：输入框隐藏（预设 provider）= 时区由表带出，不再要求手填
    if (!d.timezone.trim() && autoTzOf(d.provider) === null) return '时区不能为空（内置供应商会自动带出，其余填 IANA 名）'
    try {
      parseWhenText(d.whenText)
    } catch (e) {
      return `峰时段：${e instanceof Error ? e.message : String(e)}`
    }
    return partOk(d.peakHit, d.peakMiss, d.peakOutput) ?? partOk(d.valleyHit, d.valleyMiss, d.valleyOutput)
  }
  return partOk(d.flatHit, d.flatMiss, d.flatOutput)
}

function buildEntry(d: Draft): UserEntry {
  const e: UserEntry = { model: d.model.trim() }
  const provider = d.provider.trim().toLowerCase()
  if (provider) e.provider = provider
  // 时区只在峰谷条目上有意义（一口价不判峰谷）：空串绝不落盘（host schema min(1) 会拒）；
  // 输入框隐藏（预设 provider）时显式写入内置表值——openrouter 这类 UTC 方不依赖 host 兜底上海
  if (d.isPeak) {
    const tz = d.timezone.trim() || autoTzOf(d.provider)
    if (tz) e.timezone = tz
  }
  const part = (hit: string, miss: string, output: string): PricePart => {
    const p: PricePart = { hit: toNum(hit), miss: toNum(miss), output: toNum(output) }
    return p
  }
  if (d.isPeak) {
    e.peak = { ...part(d.peakHit, d.peakMiss, d.peakOutput), when: parseWhenText(d.whenText) }
    e.valley = part(d.valleyHit, d.valleyMiss, d.valleyOutput)
  } else {
    e.const = part(d.flatHit, d.flatMiss, d.flatOutput)
  }
  if (d.cacheSaving.trim()) e.cacheSaving = d.cacheSaving.trim()
  return e
}

// ── UI 基元 ─────────────────────────────────────────────────────────────────

const el = React.createElement

function PriceInputs(props: { d: Draft; set: (patch: Partial<Draft>) => void; mode: 'flat' | 'peak' | 'valley' }): any {
  const { d, set, mode } = props
  const key = (k: keyof Draft): keyof Draft => k
  const hit = mode === 'flat' ? key('flatHit') : mode === 'peak' ? key('peakHit') : key('valleyHit')
  const miss = mode === 'flat' ? key('flatMiss') : mode === 'peak' ? key('peakMiss') : key('valleyMiss')
  const output = mode === 'flat' ? key('flatOutput') : mode === 'peak' ? key('peakOutput') : key('valleyOutput')
  const cell = (labelText: string, k: keyof Draft): any =>
    el(
      'span',
      { className: 'meowcb_set_price' },
      el('span', { className: 'meowcb_set_label' }, labelText),
      el('input', {
        className: 'meowcb_set_input meowcb_set_input_num',
        value: d[k] as string,
        onChange: (e: any) => set({ [k]: e.target.value } as Partial<Draft>),
        inputMode: 'decimal',
        placeholder: '元/百万',
      }),
    )
  return el(
    'div',
    { className: 'meowcb_set_line' },
    cell('缓存命中', hit),
    cell('缓存未命中', miss),
    cell('输出', output),
  )
}

// ── 卡片组件 ────────────────────────────────────────────────────────────────

function BillingCard(props: { scope: any; scan?: () => Promise<CatalogModel[]> }): any {
  const scope = props.scope
  const subscribe = React.useCallback((cb: () => void) => scope.subscribe(cb), [scope])
  const getSnapshot = React.useCallback(() => scope.getSnapshot(), [scope])
  const snap: {
    status: string
    value: EntryMap | undefined
    base: EntryMap | undefined
    user: EntryMap | undefined
    writable: boolean
    mode: string
  } = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  // DSH 模型目录：进页面扫一次；每次打开编辑器再扫一次（设置页 section 可能常驻不重挂，
  // 只靠挂载扫描会变陈旧）。null=还没扫到（纯手输）；扫描失败不动旧值。
  const [catalog, setCatalog] = React.useState<CatalogModel[] | null>(null)
  const catalogGen = React.useRef(0)
  const refreshCatalog = React.useCallback((): void => {
    if (!props.scan) return
    const gen = ++catalogGen.current
    props.scan().then(
      (rows) => {
        if (gen === catalogGen.current) setCatalog(rows)
      },
      () => {},
    )
  }, [props.scan])
  React.useEffect(() => {
    refreshCatalog()
  }, [refreshCatalog])

  // 预填层双保险：host base（0.1.6=installSettingsSection 传的运行时 rates.yml；
  // 0.1.7=schema 默认深填——dict(any) 根声明不了按键默认，恒空）打不上来的部分
  // 由 client 自带的编译期快照兜住（prefill.gen.ts，build 从 rates.yml 再生成，
  // 与 cordis.patch.yml 同步换代）。host base 在场时优先：0.1.6 手改 rates.yml
  // 重启后，显示跟运行时走。
  const base = { ...(PREFILL_RATES as EntryMap), ...(snap.base ?? {}) }
  const user = snap.user ?? {}
  const keys = Array.from(new Set([...Object.keys(base), ...Object.keys(user)]))

  const set = (patch: Partial<Draft>): void => {
    setError(null)
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  const open = (key: string | null, prefillProvider?: string): void => {
    setError(null)
    if (key === null) {
      setExpanded(null)
      setDraft(null)
      return
    }
    const entry = key === '__new__' ? undefined : (user[key] ?? base[key])
    const d = entry ? draftFromEntry(entry) : emptyDraft()
    // 组头「添加」入口：provider 预填为该组，内置供应商顺带带出账单时区（与手输 provider 的自动带出一致）
    if (!entry && prefillProvider) {
      d.provider = prefillProvider
      const known = PROVIDER_TIMEZONE[prefillProvider]
      if (known) d.timezone = known
    }
    setDraft(d)
    setExpanded(key)
    refreshCatalog()
  }

  const save = async (): Promise<void> => {
    if (!draft || !expanded) return
    const err = validateDraft(draft)
    if (err) {
      setError(err)
      return
    }
    const entry = buildEntry(draft)
    const key = expanded === '__new__' ? entryKey(entry) : expanded
    setBusy(true)
    try {
      const r = await scope.set(key, entry)
      // 0.1.6 settingsScope 回 {result:{ok,error}}；0.1.7 configForms 回 boolean
      //（false=宿主拒收且详情被吞）。false 必须亮红字——否则被拒写成假成功，
      // 行徽章纹丝不动，用户以为存上了（2026-09-25 探针实证过的静默失败）。
      const bad =
        r === false
          ? '宿主拒收本次写入（重启页面后重试；反复失败看浏览器控制台 [meow-cachebilling] 取证行）'
          : r && r.result && r.result.ok === false
            ? r.result.error?.message
            : null
      if (bad) {
        setError(`保存被拒绝：${bad}`)
        console.warn('[meow-cachebilling] settings 写入被宿主拒收：', key)
        return
      }
      setExpanded(null)
      setDraft(null)
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (key: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await scope.unset(key)
      if (r === false) {
        setError('恢复预填被宿主拒收，请重试（反复失败看浏览器控制台）。')
        return
      }
      setExpanded(null)
      setDraft(null)
    } catch (e) {
      setError(`操作失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  if (snap.status === 'loading') {
    return el('div', { className: 'meowcb_set_card' }, el('span', { className: 'meowcb_set_muted' }, '价目表加载中…'))
  }
  if (snap.status === 'unavailable') {
    return el(
      'div',
      { className: 'meowcb_set_card' },
      el('span', { className: 'meowcb_set_muted' }, '当前连接不支持设置写入（仅本机回环连接可编辑）。'),
    )
  }

  const tzFor = (provider: string): { auto: boolean; tz: string } => {
    const auto = autoTzOf(provider)
    if (auto) return { auto: true, tz: auto }
    return { auto: false, tz: draft?.timezone ?? 'UTC' }
  }

  const editor =
    draft === null
      ? null
      : el(
          'div',
          { className: 'meowcb_set_editor' },
          // 第一行：供应商 + 模型 + 峰谷开关
          el(
            'div',
            { className: 'meowcb_set_line' },
            el('span', { className: 'meowcb_set_label' }, '供应商'),
            el('input', {
              className: 'meowcb_set_input meowcb_set_input_grow',
              list: PROVIDER_DATALIST_ID,
              value: draft.provider,
              onChange: (e: any) => {
                const provider = e.target.value
                const known = PROVIDER_TIMEZONE[provider.trim().toLowerCase()]
                set(known ? { provider, timezone: known } : { provider })
              },
              placeholder: 'deepseek-official / openrouter，留空=通配',
            }),
            el('span', { className: 'meowcb_set_label' }, '模型'),
            el('input', {
              className: 'meowcb_set_input meowcb_set_input_grow',
              list: MODEL_DATALIST_ID,
              value: draft.model,
              onChange: (e: any) => {
                const model = e.target.value
                // 目录唯一命中且供应商还空着：顺带带出供应商（内置的连时区一起）
                const hit = uniqueProviderFor(model, catalog)
                if (hit !== null && !draft.provider.trim()) {
                  const known = PROVIDER_TIMEZONE[hit]
                  set(known ? { model, provider: hit, timezone: known } : { model, provider: hit })
                  return
                }
                set({ model })
              },
              placeholder: 'glm-5.3-flash',
            }),
            el(
              'label',
              { className: 'meowcb_set_check' },
              el('input', {
                type: 'checkbox',
                checked: draft.isPeak,
                onChange: (e: any) => set({ isPeak: e.target.checked }),
              }),
              el('span', null, '是峰谷价'),
            ),
          ),
          draft.isPeak
            ? el(
                'div',
                { className: 'meowcb_set_editor' },
                // 峰价 + 时间同行；时区仅供应商不在内置表时出现
                el(
                  'div',
                  { className: 'meowcb_set_line' },
                  el('span', { className: 'meowcb_set_label' }, '峰价'),
                  el('input', {
                    className:
                      'meowcb_set_input meowcb_set_input_time' +
                      (draft.whenText.trim() ? '' : ' meowcb_set_input_err'),
                    value: draft.whenText,
                    onChange: (e: any) => set({ whenText: e.target.value }),
                    placeholder: '[mon-fri][09:00-12:00, 14:00-18:00]，多组用 + 连接',
                  }),
                  tzFor(draft.provider).auto
                    ? null
                    : el(
                        'span',
                        { className: 'meowcb_set_price' },
                        el('span', { className: 'meowcb_set_label' }, '时区'),
                        el('input', {
                          className: 'meowcb_set_input meowcb_set_input_save' + (draft.timezone.trim() ? '' : ' meowcb_set_input_err'),
                          value: draft.timezone,
                          onChange: (e: any) => set({ timezone: e.target.value }),
                          placeholder: 'Asia/Shanghai',
                        }),
                      ),
                ),
                el(PriceInputs, { d: draft, set, mode: 'peak' }),
                el('div', { className: 'meowcb_set_section' }, '谷价'),
                el(PriceInputs, { d: draft, set, mode: 'valley' }),
              )
            : el(PriceInputs, { d: draft, set, mode: 'flat' }),
          error ? el('div', { className: 'meowcb_set_err' }, error) : null,
          el(
            'div',
            { className: 'meowcb_set_actions' },
            el(
              'button',
              { className: 'meowcb_set_input', disabled: busy, onClick: () => void save() },
              busy ? '保存中…' : '保存',
            ),
            el(
              'button',
              { className: 'meowcb_set_input', disabled: busy, onClick: () => open(null) },
              '取消',
            ),
          ),
        )

  const renderRow = (key: string): any => {
    const entry = user[key] ?? base[key]
    if (!entry) return null
    const inBase = key in base
    const inUser = key in user
    const overridden = inBase && inUser
    const custom = inUser && !inBase
    const isExpanded = expanded === key
    const badge = overridden
      ? el('span', { className: 'meowcb_set_badge meowcb_set_badge_override' }, '已覆盖')
      : custom
        ? el('span', { className: 'meowcb_set_badge meowcb_set_badge_custom' }, '自定义')
        : el('span', { className: 'meowcb_set_badge meowcb_set_badge_prefill' }, '预填')
    const tier = entry.peak ? '（峰谷）' : ''
    // 供应商已上移到组头，行内只报模型名
    return isExpanded
      ? React.cloneElement(editor as any, { key })
      : el(
          'div',
          {
            key,
            className: 'meowcb_set_row',
            onClick: () => open(key),
          },
          el('span', null, `${entry.model}${tier}`),
          badge,
        )
  }

  // 按 provider 分组展示（条目 key 前缀本就是 provider/model）：通配组（无 provider）排最前，
  // 其余按名称排序；组内保持「预填按 rates.yml 顺序 → 自定义追加」的原有顺序
  const groups: { provider: string; keys: string[] }[] = []
  const byProvider = new Map<string, string[]>()
  for (const key of keys) {
    const entry = user[key] ?? base[key]
    if (!entry) continue
    const provider = (entry.provider ?? '').toLowerCase()
    let bucket = byProvider.get(provider)
    if (!bucket) {
      bucket = []
      byProvider.set(provider, bucket)
      groups.push({ provider, keys: bucket })
    }
    bucket.push(key)
  }
  groups.sort((a, b) => {
    if (!a.provider) return -1
    if (!b.provider) return 1
    return a.provider.localeCompare(b.provider)
  })

  const rows = groups.map((g) =>
    el(
      'div',
      { key: `meowcb_group_${g.provider || '*'}`, className: 'meowcb_set_block' },
      el(
        'div',
        { className: 'meowcb_set_group' },
        el('span', { className: 'meowcb_set_group_name' }, g.provider || '全部路由'),
        el('span', { className: 'meowcb_set_group_count' }, `${g.keys.length} 个模型`),
        el(
          'button',
          {
            className: 'meowcb_set_input meowcb_set_group_add',
            onClick: () => open('__new__', g.provider || undefined),
          },
          '添加',
        ),
      ),
      el('div', { className: 'meowcb_set_items' }, ...g.keys.map((key) => renderRow(key))),
    ),
  )

  const expandedIsNew = expanded === '__new__'

  // datalist 候选：模型按 id 去重（多供应商共用时把供应商列进标签里）；供应商取唯一值排序
  const modelOptions: any[] = []
  const providerOptions: any[] = []
  if (catalog !== null) {
    const providersByModel = new Map<string, Set<string>>()
    for (const row of catalog) {
      let ps = providersByModel.get(row.model)
      if (!ps) {
        ps = new Set()
        providersByModel.set(row.model, ps)
      }
      ps.add(row.provider)
    }
    for (const [model, providers] of [...providersByModel].sort((a, b) => a[0].localeCompare(b[0]))) {
      modelOptions.push(el('option', { key: model, value: model }, [...providers].sort().join(' / ')))
    }
    for (const p of [...new Set(catalog.map((row) => row.provider))].sort()) {
      providerOptions.push(el('option', { key: p, value: p }))
    }
  }

  return el(
    'div',
    { className: 'meowcb_set_card' },
    el(
      'p',
      { className: 'meowcb_set_intro' },
      '价目表分两层：插件自带的预填（跟随版本更新）+ 你在下面的修改（保存在 DSH 设置里，改完即时生效）。点击任意一行展开编辑；编辑预填条目会生成覆盖，可随时恢复预填。',
    ),
    !snap.writable
      ? el('span', { className: 'meowcb_set_muted' }, '当前连接为只读（设置写入仅限本机回环连接）。')
      : null,
    expandedIsNew ? editor : null,
    el(
      'div',
      { className: 'meowcb_set_actions' },
      el(
        'button',
        { className: 'meowcb_set_input', onClick: () => open('__new__'), disabled: expandedIsNew },
        '添加条目',
      ),
    ),
    ...rows,
    modelOptions.length > 0 ? el('datalist', { key: 'dl-model', id: MODEL_DATALIST_ID }, modelOptions) : null,
    providerOptions.length > 0
      ? el('datalist', { key: 'dl-provider', id: PROVIDER_DATALIST_ID }, providerOptions)
      : null,
  )
}

// ── 挂载 ────────────────────────────────────────────────────────────────────

/** 可选服务软取：cordis 对未声明服务的属性访问直接抛 rejectGuard（可选链防不住），
 *  ctx.get 不抛（缺服务返回 undefined）；无 ctx.get 的环境（含测试 mock）退回
 *  属性读取并用 try/catch 兜住。 */
function softService(ctx: any, name: string): any {
  if (typeof ctx?.get === 'function') return ctx.get(name)
  try { return ctx?.[name] } catch { return undefined }
}

/** 轮询参数（测试可注入短周期；生产默认 400ms × 75 ≈ 30s 后放弃并留日志）。 */
export interface SettingsMountOptions {
  pollMs?: number
  maxPollAttempts?: number
}

export function applySettings(ctx: any, opts?: SettingsMountOptions): void {
  // 覆盖式注入：外壳重注入插件时旧 style 标签仍在 document 里，只判空插入会让升级后的新样式永远进不来
  if (typeof document !== 'undefined') {
    let tag = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${CSS_ID}"]`)
    if (tag === null) {
      tag = document.createElement('style')
      tag.dataset.plugin = 'meow-cachebilling-settings'
      tag.dataset.pluginCss = CSS_ID
      document.head.appendChild(tag)
    }
    tag.textContent = CSS
  }

  // DSH 模型目录扫描：借用模型选择器的同一份 RPC，目录 = settings+预置合并后的最终目录（全局投影，与会话无关）。
  // 两个构建的面不同：0.1.5-rc.1 = remote.session.modelCatalog()（无参数，rc.1 里没有 sessions.models 这个
  // RPC——照新版源码写会静默扫空）；更新构建 = connection.api.sessions.models({sessionId})。失败 → 空表，纯手输。
  // 每一步的探测结果写 window.__meowcbScanTrace（排障用；守卫代理读服务是 throw 不是 undefined，必须整体兜住）。
  const scanCatalog = async (): Promise<CatalogModel[]> => {
    const trace: string[] = []
    const publish = (): void => {
      ;(window as any).__meowcbScanTrace = trace
    }
    try {
      // rc.1 的 remote 面要求 inject 声明 'remote.session' 才能给属性访问器；但声明它会在没有该服务的
      // 新版构建上把插件 park 死。ctx.get() 是显式解析，不走声明检查，两条路都试。
      const candidates: Array<{ label: string; face: any }> = []
      try {
        const viaGet = typeof (ctx as any).get === 'function' ? (ctx as any).get('remote.session') : undefined
        candidates.push({ label: `ctx.get(remote.session)=${typeof viaGet?.modelCatalog}`, face: viaGet })
      } catch (e) {
        candidates.push({ label: `ctx.get threw: ${e instanceof Error ? e.message : String(e)}`, face: undefined })
      }
      try {
        const viaProp = (ctx as any).remote?.session
        candidates.push({ label: `ctx.remote.session=${typeof viaProp?.modelCatalog}`, face: viaProp })
      } catch (e) {
        candidates.push({ label: `ctx.remote.session threw: ${e instanceof Error ? e.message : String(e)}`, face: undefined })
      }
      for (const c of candidates) {
        trace.push(c.label)
        if (typeof c.face?.modelCatalog !== 'function') continue
        const r = await c.face.modelCatalog()
        const res = (r as any)?.result ?? r
        trace.push(`rc1 ok=${String(res?.ok)} groups=${String(res?.value?.groups?.length)}`)
        if (res?.ok) {
          const rows = groupsToRows(res.value?.groups)
          if (rows.length > 0) {
            publish()
            return rows
          }
        }
      }
    } catch (e) {
      trace.push(`rc1 threw: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      const sessions = (ctx as any).sessions
      const api = (ctx as any).connection?.api?.sessions
      trace.push(`sessions=${typeof sessions} api.sessions.models=${typeof api?.models} list=${typeof sessions?.list?.getSnapshot}`)
      if (sessions?.list?.getSnapshot && typeof api?.models === 'function') {
        const snap = sessions.list.getSnapshot()
        const ids: string[] = Array.isArray(snap?.ids) ? snap.ids : Object.keys(snap?.byId ?? {})
        const candidates = [snap?.current, ...ids].filter(
          (id: unknown): id is string => typeof id === 'string' && id.length > 0,
        )
        trace.push(`candidates=${candidates.length}`)
        for (const sessionId of candidates) {
          if (sessions.subagentAddress?.(sessionId)) continue
          try {
            const r = await api.models({ sessionId })
            const res = (r as any)?.result ?? r
            trace.push(`sess ok=${String(res?.ok)} groups=${String(res?.value?.groups?.length ?? 'n/a')}`)
            if (res?.ok) {
              const rows = groupsToRows(res.value?.groups)
              if (rows.length > 0) {
                publish()
                return rows
              }
            }
          } catch {
            trace.push('sess threw, next candidate')
          }
        }
      }
    } catch (e) {
      trace.push(`fallback threw: ${e instanceof Error ? e.message : String(e)}`)
    }
    publish()
    return []
  }

  // 双版本两条腿的公共挂载体：scope 由腿产出（0.1.6=settingsScope.bind 结果；
  // 0.1.7=configForms.get(entryId) 共享表单——形状与组件吃的 scope 同构：
  // getSnapshot 的 status/value/base/user/writable/mode、单层键 set/unset、被拒
  // 静默 recover 回读判定，直接当 scope 用）。共享表单由 configForms 提供方持有
  // 并随其卸载，这里不 dispose（dispose 后 forms 表仍缓存该实例，热重载拿到死表单）。
  const mount = (scope: any): void => {
    // 顶级分区（与「通用」「模型」「插件」平级）：list slot 契约 = id + order + label；
    // label 直接返回中文——不挂 locale 字典（第三方字典注册在官方外壳没有席位，旧卡片形态实测注册不上）。
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: SETTINGS_NS,
          order: 30,
          label: () => '喵缓存账单',
          inject: (): unknown => ({ scope, scan: scanCatalog }),
        },
        BillingSection,
      ),
    )
  }

  // ── 0.1.6 腿：settingsScope 服务在，原链路不变 ─────────────────────────────
  const settingsScope = softService(ctx, 'settingsScope')
  if (settingsScope !== undefined) {
    mount(settingsScope.bind({ namespace: SETTINGS_NS }))
    return
  }

  // ── 0.1.7 腿：settingsScope 被官方移除，等 configForms 提供方就绪 ──────────
  // configForms 不进 inject（0.1.6 无此服务，写进清单会整插件 pending），且客户端
  // 组合顺序不保证提供方先起——短轮询等它就绪再挂页；等不到只留一行日志，
  // 账单主体不受影响。
  const pollMs = opts?.pollMs ?? 400
  const maxPollAttempts = opts?.maxPollAttempts ?? 75
  let mounted = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let attempts = 0
  const stopPoll = (): void => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  }
  const attach = (): void => {
    if (mounted) return
    const configForms = softService(ctx, 'configForms')
    if (configForms === undefined || typeof configForms.get !== 'function') return
    mounted = true
    stopPoll()
    try {
      mount(configForms.get(SETTINGS_NS))
    } catch (e) {
      console.warn('[meow-cachebilling] 设置页注册失败（不影响账单）：', e)
    }
  }
  attach()
  if (!mounted) {
    pollTimer = setInterval(() => {
      attach()
      attempts += 1
      if (!mounted && attempts >= maxPollAttempts) {
        stopPoll()
        console.info('[meow-cachebilling] configForms 服务未就绪（0.1.7 设置页未注册；账单不受影响）')
      }
    }, pollMs)
  }
}

/** 顶级分区整页：标题 + 说明 + 价目表主体（BillingCard）。 */
function BillingSection(props: { scope: any; scan?: () => Promise<CatalogModel[]> }): any {
  return el(
    'div',
    { className: 'meowcb_set_page' },
    el('h2', { className: 'meowcb_set_title' }, '喵缓存账单'),
    el(
      'p',
      { className: 'meowcb_set_subtitle' },
      '上下文缓存到底花了多少钱，这里能改价、能补价。改完即时生效，无需重启。',
    ),
    el(BillingCard, { scope: props.scope, scan: props.scan }),
  )
}
