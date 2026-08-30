/**
 * meow-cachebilling — 设置页模块（喵缓存账单）。
 *
 * 独立模块：只管设置页的显示与读写，不掺和账单渲染；由 client.ts 引入（一行 applySettings(ctx)，失败仅警告不影响账单）。
 * 形态：设置页顶级分区（settings.section，与「通用」「模型」「插件」平级的独立标签页）。
 * 2026-08-30 猫猫拍板「我们需要在设置加个标签页，不是把信息加到别人的标签页里」——由旧形态（settings.plugin.item 卡片，住在官方插件 tab）升级而来。
 * 契约照官方 settings.section（ui-settings-general / ui-settings-models 同款）：
 *   - host 半身（index.ts）用 installSettingsSection 注册命名空间 meow-cachebilling，base = 包根 rates.yml 预填层（不变）
 *   - 浏览器半身挂 settings.section（list slot：id + order + label），整页渲染价目表
 *   - 快照三视图：value(合成) / base(预填) / user(用户覆盖)；scope.set(field, value) 写用户层、scope.unset(field) 清回预填
 *   - 双层语义：key 存在于 user 层即覆盖预填条目；「恢复预填」= unset；自定义条目删除 = unset
 *   - host 端 scope.watch → onChange → 重编译合成层：设置页改价目即时生效，无需重启
 */

import * as React from 'react'

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
.meowcb_set_label{color:var(--dsw-alias-label-secondary);font-size:12px;min-width:72px}
.meowcb_set_input{background:transparent;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;color:inherit;font-size:13px;padding:4px 8px}
.meowcb_set_input_num{width:96px}
.meowcb_set_input_time{flex:1;min-width:240px;font-family:ui-monospace,monospace}
.meowcb_set_input_err{border-color:#f43f5e}
.meowcb_set_err{color:#f43f5e;font-size:12px;line-height:1.5;margin:0;white-space:pre-wrap}
.meowcb_set_actions{display:flex;gap:8px;margin-top:2px}
.meowcb_set_muted{color:var(--dsw-alias-label-caption);font-size:12px}
.meowcb_set_section{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;margin-top:4px}
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

/** 保存前校验：返回错误文案或 null。价格必须是非负数字；峰谷必须配齐时间。 */
function validateDraft(d: Draft): string | null {
  if (!d.model.trim()) return 'model 不能为空'
  if (!d.timezone.trim()) return 'timezone 不能为空（选一个 provider 自动带出，或手动填 IANA 名）'
  const numOk = (v: string): boolean => v.trim() !== '' && Number.isFinite(toNum(v)) && toNum(v) >= 0
  const partOk = (hit: string, miss: string, output: string): string | null => {
    if (!numOk(hit) || !numOk(miss) || !numOk(output)) return '价格必须是非负数字（元 / 百万 token）'
    return null
  }
  if (d.isPeak) {
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
  e.timezone = d.timezone.trim()
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

function Field(props: { label: string; children: React.ReactNode }): any {
  return el(
    'div',
    { className: 'meowcb_set_line' },
    el('span', { className: 'meowcb_set_label' }, props.label),
    props.children,
  )
}

function PriceInputs(props: { d: Draft; set: (patch: Partial<Draft>) => void; mode: 'flat' | 'peak' | 'valley' }): any {
  const { d, set, mode } = props
  const key = (k: keyof Draft): keyof Draft => k
  const hit = mode === 'flat' ? key('flatHit') : mode === 'peak' ? key('peakHit') : key('valleyHit')
  const miss = mode === 'flat' ? key('flatMiss') : mode === 'peak' ? key('peakMiss') : key('valleyMiss')
  const output = mode === 'flat' ? key('flatOutput') : mode === 'peak' ? key('peakOutput') : key('valleyOutput')
  return el(
    'div',
    { className: 'meowcb_set_line' },
    el('span', { className: 'meowcb_set_label' }, '缓存命中'),
    el('input', {
      className: 'meowcb_set_input meowcb_set_input_num',
      value: props.d[hit] as string,
      onChange: (e: any) => props.set({ [hit]: e.target.value } as Partial<Draft>),
      inputMode: 'decimal',
      placeholder: '元/百万',
    }),
    el('span', { className: 'meowcb_set_label' }, '缓存未命中'),
    el('input', {
      className: 'meowcb_set_input meowcb_set_input_num',
      value: props.d[miss] as string,
      onChange: (e: any) => props.set({ [miss]: e.target.value } as Partial<Draft>),
      inputMode: 'decimal',
      placeholder: '元/百万',
    }),
    el('span', { className: 'meowcb_set_label' }, '输出'),
    el('input', {
      className: 'meowcb_set_input meowcb_set_input_num',
      value: props.d[output] as string,
      onChange: (e: any) => props.set({ [output]: e.target.value } as Partial<Draft>),
      inputMode: 'decimal',
      placeholder: '元/百万',
    }),
  )
}

// ── 卡片组件 ────────────────────────────────────────────────────────────────

function BillingCard(props: { scope: any }): any {
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

  const base = snap.base ?? {}
  const user = snap.user ?? {}
  const keys = Array.from(new Set([...Object.keys(base), ...Object.keys(user)]))

  const set = (patch: Partial<Draft>): void => {
    setError(null)
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  const open = (key: string | null): void => {
    setError(null)
    if (key === null) {
      setExpanded(null)
      setDraft(null)
      return
    }
    const entry = key === '__new__' ? undefined : (user[key] ?? base[key])
    setDraft(entry ? draftFromEntry(entry) : emptyDraft())
    setExpanded(key)
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
      const bad = r && r.result && r.result.ok === false ? r.result.error?.message : null
      if (bad) {
        setError(`保存被拒绝：${bad}`)
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
      await scope.unset(key)
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
    const p = provider.trim().toLowerCase()
    if (p && PROVIDER_TIMEZONE[p]) return { auto: true, tz: PROVIDER_TIMEZONE[p] }
    return { auto: false, tz: draft?.timezone ?? 'UTC' }
  }

  const editor =
    draft === null
      ? null
      : el(
          'div',
          { className: 'meowcb_set_editor' },
          el(
            Field,
            { label: 'provider' },
            el('input', {
              className: 'meowcb_set_input',
              value: draft.provider,
              onChange: (e: any) => {
                const provider = e.target.value
                const known = PROVIDER_TIMEZONE[provider.trim().toLowerCase()]
                set(known ? { provider, timezone: known } : { provider })
              },
              placeholder: '如 deepseek-official / openrouter（留空 = 通配）',
            }),
            el('span', { className: 'meowcb_set_muted' }, '留空 = 对该模型所有路由生效'),
          ),
          el(
            Field,
            { label: 'model' },
            el('input', {
              className: 'meowcb_set_input',
              value: draft.model,
              onChange: (e: any) => set({ model: e.target.value }),
              placeholder: '与 API 返回写法一致，如 glm-5.3-flash',
            }),
          ),
          el(
            Field,
            { label: '时区' },
            tzFor(draft.provider).auto
              ? el('span', { className: 'meowcb_set_muted' }, `自动（计费方账单时区）：${tzFor(draft.provider).tz}`)
              : el('input', {
                  className: 'meowcb_set_input' + (draft.timezone.trim() ? '' : ' meowcb_set_input_err'),
                  value: draft.timezone,
                  onChange: (e: any) => set({ timezone: e.target.value }),
                  placeholder: 'IANA 名，如 Asia/Shanghai / America/New_York',
                }),
          ),
          el(
            'label',
            { className: 'meowcb_set_line', style: { cursor: 'pointer' } },
            el('input', {
              type: 'checkbox',
              checked: draft.isPeak,
              onChange: (e: any) => set({ isPeak: e.target.checked }),
            }),
            el('span', null, '是峰谷价（不勾 = 24 小时一口价）'),
          ),
          draft.isPeak
            ? el(
                'div',
                { className: 'meowcb_set_editor' },
                el('div', { className: 'meowcb_set_section' }, '峰价'),
                el(
                  Field,
                  { label: '时间' },
                  el('input', {
                    className:
                      'meowcb_set_input meowcb_set_input_time' +
                      (draft.whenText.trim() ? '' : ' meowcb_set_input_err'),
                    value: draft.whenText,
                    onChange: (e: any) => set({ whenText: e.target.value }),
                    placeholder: '[mon-fri][09:00-12:00, 14:00-18:00]，多组用 + 连接',
                  }),
                ),
                el(PriceInputs, { d: draft, set, mode: 'peak' }),
                el('div', { className: 'meowcb_set_section' }, '谷价（时段自动取峰的补集，含周末全天谷）'),
                el(PriceInputs, { d: draft, set, mode: 'valley' }),
              )
            : el(
                'div',
                { className: 'meowcb_set_editor' },
                el(PriceInputs, { d: draft, set, mode: 'flat' }),
              ),
          el(
            Field,
            { label: 'cacheSaving' },
            el('input', {
              className: 'meowcb_set_input',
              value: draft.cacheSaving,
              onChange: (e: any) => set({ cacheSaving: e.target.value }),
              placeholder: '服务器缓存保留时长（实测后回填，现在没有逻辑）',
            }),
          ),
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

  const rows = keys.map((key) => {
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
    return isExpanded
      ? editor
      : el(
          'div',
          {
            key,
            className: 'meowcb_set_row',
            onClick: () => open(key),
          },
          el('span', null, `${entry.provider ?? '*'} / ${entry.model}${tier}`),
          badge,
        )
  })

  const expandedIsNew = expanded === '__new__'

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
  )
}

// ── 挂载 ────────────────────────────────────────────────────────────────────

export function applySettings(ctx: any): void {
  if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'meow-cachebilling-settings'
    tag.dataset.pluginCss = CSS_ID
    tag.textContent = CSS
    document.head.appendChild(tag)
  }

  const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NS })

  // 顶级分区（与「通用」「模型」「插件」平级）：list slot 契约 = id + order + label；
  // label 直接返回中文——不挂 locale 字典（第三方字典注册在官方外壳没有席位，旧卡片形态实测注册不上）。
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: SETTINGS_NS,
        order: 30,
        label: () => '喵缓存账单',
        inject: (): unknown => ({ scope }),
      },
      BillingSection,
    ),
  )
}

/** 顶级分区整页：标题 + 说明 + 价目表主体（BillingCard）。 */
function BillingSection(props: { scope: any }): any {
  return el(
    'div',
    { className: 'meowcb_set_page' },
    el('h2', { className: 'meowcb_set_title' }, '喵缓存账单'),
    el(
      'p',
      { className: 'meowcb_set_subtitle' },
      '上下文缓存到底花了多少钱，这里能改价、能补价。改完即时生效，无需重启。',
    ),
    el(BillingCard, { scope: props.scope }),
  )
}
