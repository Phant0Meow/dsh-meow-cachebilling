/**
 * dsh-cache-billing — 缓存账单浏览器端。
 *
 * 不再自带任何按钮或占位行：官方上下文圆环点开的弹层本来就是「这个会话用了多少」的语义，缓存账单的「这步花了多少、要不要换窗口」语义与之天然同源，用户拍板就该放到那里。因此监听官方弹层的打开，把账单区块直接贴进去。
 *
 * - CacheDataHook：仍经 slots 挂在 conversation.input.right 不可见处，唯一职责是让 useProjection 保持活跃，把最新投影同步进模块级 store 并刷新已打开的弹层区块。
 * - ContextPanelBridge：MutationObserver 观察官方弹层出现，role=dialog 且 aria-label 为「上下文已用 / of context used」，出现即在弹层末尾贴上账单区块，弹层关闭随 React 卸载自然消失。
 * - 第三方中转同样显示：provider 非空即放行，模型命中价目表就按估算金额计价，provider 为空时不显示。
 * - 已知边界：官方若更改弹层结构或文案，贴装会静默失效，菜单里少了账单行，不影响其他功能，届时适配新选择器即可。
 */

import * as React from 'react'

/** 样式注入标识（防重复注入）。 */
const CSS_ID = 'dsh-cache-billing-css'

/** 账单区块样式：排版语言复刻官方弹层，顶部细分隔线与官方 rows 区隔。 */
const CSS = `
.dshcb_bill{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3)}
.dshcb_billhead{align-items:center;gap:6px;display:flex;color:var(--dsw-alias-label-secondary)}
.dshcb_billtotal{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}
.dshcb_bilrows{margin:4px 0 0;padding:0}
.dshcb_bilrow{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex}
.dshcb_bilrow dt{display:flex;align-items:center;color:var(--dsw-alias-label-secondary);margin:0}
.dshcb_bilrow dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0;font-weight:500;text-align:right}
.dshcb_tok{color:var(--dsw-alias-label-caption);font-weight:400;margin-left:4px}
.dshcb_swatch{border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block;flex:none}
.dshcb_srows{margin:2px 0 0;padding:0 0 0 16px}
.dshcb_foot{margin-top:6px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
`

/** 显示判定：默认全生效，不再按 provider 名过滤。任何 provider 只要报出用量，就按模型名匹配价目表显示估算金额，provider 为空时不显示。 */
function isBillableProvider(provider: unknown): boolean {
  return typeof provider === 'string' && provider !== ''
}

/** 金额格式化，无货币符号，按级别固定小数位，会话 2 位、轮 3 位、步 4 位，尾 0 不省略，超出精度的尾数四舍五入。 */
function formatAmount(amount: number, digits: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0'
  return amount.toFixed(digits)
}

/** token 数紧凑格式：812 / 12.2K / 1.2M。 */
function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${scaled(n / 1000)}K`
  return `${scaled(n / 1_000_000)}M`
}

const TIER_LABEL: Record<string, string> = {
  peak: '梁文峰',
  offPeak: '梁文谷',
}

interface CacheBillingView {
  available?: boolean
  cost?: number
  missCost?: number
  outputCost?: number
  currency?: string
  cacheReadTokens?: number
  totalInputTokens?: number
  hitRate?: number | null
  model?: string | null
  provider?: string | null
  tier?: string | null
  unitPricePerM?: number | null
  turn?: number | null
  step?: number | null
  sessionCacheHitCost?: number
  sessionMissCost?: number
  sessionOutputCost?: number
  sessionInputTokens?: number
  sessionCacheReadTokens?: number
  sessionOutputTokens?: number
  sessionRounds?: number
  sessionMissSteps?: number
  sessionWriteTokens?: number
  sessionFullMissSteps?: number
  turnCost?: number
  turnHitCost?: number
  turnMissCost?: number
  turnOutputCost?: number
  turnTokens?: number
  turnCacheReadTokens?: number
  turnInputTokens?: number
  turnOutputTokens?: number
  outputTokens?: number
}

/** 模块级投影镜像：React hook 侧写入，命令式贴装侧读取。 */
let latestView: CacheBillingView | undefined

/** 官方弹层判定：role=dialog 加 aria-label 双语匹配上下文圆环弹层，官方 trigger 的 aria-haspopup=dialog，panel 的 aria-label 为「上下文已用」或「of context used」。 */
function isContextPanel(node: Node): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false
  if (node.getAttribute('role') !== 'dialog') return false
  const label = node.getAttribute('aria-label') ?? ''
  return /of context used|上下文已用/i.test(label)
}

/** 单条账单行：色块加标签附 token 数，负数省略，右对齐金额。 */
function buildRow(doc: Document, o: {
  color: string
  label: string
  tokens: number
  amountText: string
}): HTMLDivElement {
  const row = doc.createElement('div')
  row.className = 'dshcb_bilrow'
  const dt = doc.createElement('dt')
  const swatch = doc.createElement('span')
  swatch.className = 'dshcb_swatch'
  swatch.style.background = o.color
  dt.appendChild(swatch)
  dt.appendChild(doc.createTextNode(o.label))
  if (o.tokens >= 0) {
    const tok = doc.createElement('span')
    tok.className = 'dshcb_tok'
    tok.textContent = `${formatTokens(o.tokens)} tok`
    dt.appendChild(tok)
  }
  const dd = doc.createElement('dd')
  dd.textContent = o.amountText
  row.appendChild(dt)
  row.appendChild(dd)
  return row
}

/** 用最新投影刷新账单区块内容，区块骨架已在贴装时建好。 */
function renderBill(bill: HTMLElement): void {
  const doc = bill.ownerDocument
  if (!doc) return
  bill.textContent = ''

  const view = latestView
  const put = (el: HTMLElement): void => {
    bill.appendChild(el)
  }

  if (!view || !isBillableProvider(view.provider)) {
    // 无 provider 或无投影：什么都不贴，宁可不算。
    return
  }

  if (view.available !== true) {
    const empty = doc.createElement('div')
    empty.className = 'dshcb_foot'
    empty.textContent = '缓存账单：本会话暂无 Token 用量'
    put(empty)
    return
  }

  const cost = Number.isFinite(view.cost) ? (view.cost as number) : 0
  const missCost = Number.isFinite(view.missCost) ? (view.missCost as number) : 0
  const outputCost = Number.isFinite(view.outputCost) ? (view.outputCost as number) : 0
  const total = cost + missCost + outputCost
  const symbol = view.currency === 'USD' ? '$' : '¥'
  const tierLabel =
    typeof view.tier === 'string' && view.tier in TIER_LABEL ? TIER_LABEL[view.tier] : '估算'
  const tierText =
    typeof view.model === 'string' && view.model !== ''
      ? `${tierLabel} · ${view.model}`
      : tierLabel

  // 计时级别的三块明细：步、轮、会话。每块是标题行加总额与总 token，下面缩进细列缓存命中、未命中、输出三行，各带 token 与金额。
  const detailRows = (o: { hitTok: number; missTok: number; outTok: number;
    hit: number; miss: number; out: number; digits: number }): HTMLDivElement => {
    const rows = doc.createElement('div')
    rows.className = 'dshcb_srows'
    rows.appendChild(
      buildRow(doc, {
        color: '#34d399',
        label: '缓存命中',
        tokens: o.hitTok,
        amountText: `${symbol}${formatAmount(o.hit, o.digits)}`,
      }),
    )
    rows.appendChild(
      buildRow(doc, {
        color: '#f59e0b',
        label: '缓存未命中',
        tokens: o.missTok,
        amountText: `${symbol}${formatAmount(o.miss, o.digits)}`,
      }),
    )
    rows.appendChild(
      buildRow(doc, {
        color: '#60a5fa',
        label: '输出',
        tokens: o.outTok,
        amountText: `${symbol}${formatAmount(o.out, o.digits)}`,
      }),
    )
    return rows
  }

  // 块 1：当前步，单次 API 调用
  const stepIn = Number(view.totalInputTokens ?? 0)
  const stepHitTok = Number(view.cacheReadTokens ?? 0)
  const stepMissTok = Math.max(0, stepIn - stepHitTok)
  const stepOutTok = Number(view.outputTokens ?? 0)
  put(
    buildRow(doc, {
      color: '#a78bfa',
      label: '当前步',
      tokens: stepIn + stepOutTok,
      amountText: `${symbol}${formatAmount(total, 4)}`,
    }),
  )
  put(detailRows({ hitTok: stepHitTok, missTok: stepMissTok, outTok: stepOutTok,
    hit: cost, miss: missCost, out: outputCost, digits: 4 }))

  // 块 2：当前轮，turn 内多步累计
  const turnCost = Number.isFinite(view.turnCost) ? (view.turnCost as number) : 0
  const turnHit = Number.isFinite(view.turnHitCost) ? (view.turnHitCost as number) : 0
  const turnMiss = Number.isFinite(view.turnMissCost) ? (view.turnMissCost as number) : 0
  const turnOut = Number.isFinite(view.turnOutputCost) ? (view.turnOutputCost as number) : 0
  const turnIn = Number(view.turnInputTokens ?? 0)
  const turnHitTok = Number(view.turnCacheReadTokens ?? 0)
  const turnOutTok = Number(view.turnOutputTokens ?? 0)
  put(
    buildRow(doc, {
      color: '#22d3ee',
      label: '当前轮',
      tokens: turnIn + turnOutTok,
      amountText: `${symbol}${formatAmount(turnCost, 3)}`,
    }),
  )
  put(detailRows({ hitTok: turnHitTok, missTok: Math.max(0, turnIn - turnHitTok),
    outTok: turnOutTok, hit: turnHit, miss: turnMiss, out: turnOut, digits: 3 }))

  // 块 3：会话累计
  const sessionHit = Number.isFinite(view.sessionCacheHitCost) ? (view.sessionCacheHitCost as number) : 0
  const sessionMiss = Number.isFinite(view.sessionMissCost) ? (view.sessionMissCost as number) : 0
  const sessionOut = Number.isFinite(view.sessionOutputCost) ? (view.sessionOutputCost as number) : 0
  const sessionRounds = Number.isFinite(view.sessionRounds) ? (view.sessionRounds as number) : 0
  const sessionIn = Number(view.sessionInputTokens ?? 0)
  const sessionHitTok = Number(view.sessionCacheReadTokens ?? 0)
  const sessionOutTok = Number(view.sessionOutputTokens ?? 0)
  put(
    buildRow(doc, {
      color: '#f472b6',
      label: sessionRounds > 0 ? `会话累计 · ${sessionRounds} 步` : '会话累计',
      tokens: sessionIn + sessionOutTok,
      amountText: `${symbol}${formatAmount(sessionHit + sessionMiss + sessionOut, 2)}`,
    }),
  )
  const srows = detailRows({ hitTok: sessionHitTok,
    missTok: Math.max(0, sessionIn - sessionHitTok), outTok: sessionOutTok,
    hit: sessionHit, miss: sessionMiss, out: sessionOut, digits: 2 })
  // 缓存失效统计：写入即失效，仅部分中转报值；完全失效，任何路由可靠
  const missSteps = Number.isFinite(view.sessionMissSteps) ? (view.sessionMissSteps as number) : 0
  const writeTokens = Number.isFinite(view.sessionWriteTokens) ? (view.sessionWriteTokens as number) : 0
  const fullMissSteps = Number.isFinite(view.sessionFullMissSteps)
    ? (view.sessionFullMissSteps as number)
    : 0
  if (missSteps > 0) {
    srows.appendChild(
      buildRow(doc, {
        color: '#fb7185',
        label: `缓存失效 ${missSteps} 次`,
        tokens: writeTokens > 0 ? writeTokens : -1,
        amountText: '',
      }),
    )
  }
  if (fullMissSteps > 0) {
    srows.appendChild(
      buildRow(doc, {
        color: '#f43f5e',
        label: `完全失效 ${fullMissSteps} 次`,
        tokens: -1,
        amountText: '',
      }),
    )
  }
  put(srows)

  // 底部小字只保留峰谷价标注附模型名，轮次、模型、命中率与网页最下方统计行重复，用户反馈砍掉。
  const foot = doc.createElement('div')
  foot.className = 'dshcb_foot'
  foot.textContent = tierText
  put(foot)
}

/** 在官方弹层末尾贴上（或刷新）账单区块。 */
function ensureBill(panel: HTMLElement): void {
  let bill = panel.querySelector<HTMLElement>(':scope > .dshcb_bill')
  if (bill === null) {
    bill = panel.ownerDocument.createElement('div')
    bill.className = 'dshcb_bill'
    panel.appendChild(bill)
  }
  renderBill(bill)
}

/** 刷新当前文档中所有已打开的官方弹层（通常至多一个）。 */
function refreshOpenPanels(): void {
  if (typeof document === 'undefined') return
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]')
  for (const dlg of dialogs) {
    if (isContextPanel(dlg)) ensureBill(dlg)
  }
}

/** 监听官方弹层出现：流式期间 mutation 频繁，这里只做轻量子树扫描，命中判定失败的开销是一次 aria-label 读取，可忽略。 */
export function startPanelBridge(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {}
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (isContextPanel(node)) {
          ensureBill(node)
          return
        }
        if (node instanceof HTMLElement) {
          const dialogs = node.querySelectorAll<HTMLElement>('[role="dialog"]')
          for (const dlg of dialogs) {
            if (isContextPanel(dlg)) {
              ensureBill(dlg)
              return
            }
          }
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
  }
}

/** 数据挂钩组件：props 由 slots 注入，useProjection 同官方条目。渲染为零尺寸占位，仅保持投影订阅存活并把数据镜像进模块级 store。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CacheDataHook(props: any) {
  const data: CacheBillingView | undefined =
    typeof props.useProjection === 'function' ? props.useProjection('cacheBilling') : undefined

  ;(0, React.useEffect)(() => {
    latestView = data ?? undefined
    refreshOpenPanels()
  }, [data])

  return React.createElement('span', {
    'data-dsh-cache-billing': 'hook',
    style: { display: 'none' },
  })
}

export const inject = ['slots']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: any): void {
  if (
    typeof document !== 'undefined' &&
    document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null
  ) {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-cache-billing'
    tag.dataset.pluginCss = CSS_ID
    tag.textContent = CSS
    document.head.appendChild(tag)
  }
  if (typeof document !== 'undefined') {
    startPanelBridge()
  }
  // 数据挂钩仍走 slots：拿到 slots 注入的 useProjection，同官方条目的取数通道。
  ctx.slots.inject('conversation.input.right', () => {
    const dispose = ctx.slots.register(
      {
        name: 'conversation.input.right',
        id: 'dsh-cache-billing-data-hook',
        order: 1,
      },
      CacheDataHook,
    )
    return () => {
      dispose()
    }
  })
}
