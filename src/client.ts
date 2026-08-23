/**
 * meow-cachebilling — 喵账单（浏览器端）。
 *
 * 不再自带任何按钮/占位行：官方上下文圆环（ContextMeter）点开的弹层
 * 本来就是「这个会话用了多少」的语义，喵账单的「这轮花了多少 +
 * 换窗口指导」语义与之天然同源（2026-08-23 用户拍板："就应该放到
 * 那里"）。因此监听官方弹层的打开，把账单区块直接贴进去：
 *
 * - CacheDataHook：仍经 slots 挂在 conversation.input.right（不可见），
 *   唯一职责是让 useProjection('cacheBilling') 保持活跃，把最新投影
 *   同步进模块级 store 并刷新已打开的弹层区块。
 * - ContextPanelBridge：MutationObserver 观察官方弹层（role=dialog 且
 *   aria-label 为「上下文已用 / of context used」）出现，出现即在弹层
 *   末尾贴上账单区块；弹层关闭随 React 卸载自然消失。
 * - 仅 DeepSeek 官方路由显示：第三方网关价格表不同，provider 判定不过
 *   就不贴——宁可不算，不算错。
 * - 已知边界：官方若更改弹层结构或文案，贴装会静默失效（菜单里少了
 *   账单行，不影响其他功能），届时适配新选择器即可。
 */

import * as React from 'react'

/** 样式注入标识（防重复注入）。 */
const CSS_ID = 'meow-cachebilling-css'

/** 账单区块样式：排版语言复刻官方弹层（12px/tabular-nums/caption 灰），
 *  顶部细分隔线与官方 rows 区隔。 */
const CSS = `
.meowcb_bill{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3)}
.meowcb_billhead{align-items:center;gap:6px;display:flex;color:var(--dsw-alias-label-secondary)}
.meowcb_billtotal{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}
.meowcb_bilrows{margin:4px 0 0;padding:0}
.meowcb_bilrow{justify-content:space-between;align-items:center;gap:12px;padding:2px 0;display:flex}
.meowcb_bilrow dt{display:flex;align-items:center;color:var(--dsw-alias-label-secondary);margin:0}
.meowcb_bilrow dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0;font-weight:500;text-align:right}
.meowcb_tok{color:var(--dsw-alias-label-caption);font-weight:400;margin-left:4px}
.meowcb_swatch{border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block;flex:none}
.meowcb_foot{margin-top:6px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
`

/** 仅 DeepSeek 官方路由显示。真实 provider 字符串值由 host probe 日志校准；
 *  当前口径：名字含 deepseek 即视为官方（第三方网关一般以自家名作 provider，
 *  模型名才带 deepseek 字样）。校准后收紧为精确匹配。 */
function isOfficialDeepSeek(provider: unknown): boolean {
  if (typeof provider !== 'string' || provider === '') return false
  return provider.toLowerCase().includes('deepseek')
}

/** 金额数字格式化（无货币符号）：≥0.01 保留两位小数；<0.01 保留 1 位
 *  有效数字（2026-08-23 用户拍板：全小数位太长看着眼晕）——
 *  0.0015→0.002、0.0006→0.0006、0.000012→0.00001。toFixed 收尾去尾零，
 *  避免 String() 对 <1e-6 输出科学计数法（¥1e-7 没法看）。 */
function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0'
  if (amount < 0.01) {
    const magnitude = Math.floor(Math.log10(amount))
    const rounded = Math.round(amount * Math.pow(10, -magnitude)) / Math.pow(10, -magnitude)
    return rounded
      .toFixed(Math.max(0, -magnitude))
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, '')
  }
  return amount.toFixed(2)
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
  peak: '峰时价',
  offPeak: '谷时价',
  flat: '平价',
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
}

/** 模块级投影镜像：React hook 侧写入，命令式贴装侧读取。 */
let latestView: CacheBillingView | undefined

/** 官方弹层判定：role=dialog + aria-label 双语匹配 ContextMeter 弹层。
 *  （官方 trigger 的 aria-haspopup=dialog、panel 的 aria-label=t("context.used")，
 *  中文「上下文已用」/ 英文「of context used」。） */
function isContextPanel(node: Node): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false
  if (node.getAttribute('role') !== 'dialog') return false
  const label = node.getAttribute('aria-label') ?? ''
  return /of context used|上下文已用/i.test(label)
}

/** 单条账单行：色块 + 标签（附 token 数，负数省略）+ 右对齐金额。 */
function buildRow(doc: Document, o: {
  color: string
  label: string
  tokens: number
  amountText: string
}): HTMLDivElement {
  const row = doc.createElement('div')
  row.className = 'meowcb_bilrow'
  const dt = doc.createElement('dt')
  const swatch = doc.createElement('span')
  swatch.className = 'meowcb_swatch'
  swatch.style.background = o.color
  dt.appendChild(swatch)
  dt.appendChild(doc.createTextNode(o.label))
  if (o.tokens >= 0) {
    const tok = doc.createElement('span')
    tok.className = 'meowcb_tok'
    tok.textContent = `${formatTokens(o.tokens)} tok`
    dt.appendChild(tok)
  }
  const dd = doc.createElement('dd')
  dd.textContent = o.amountText
  row.appendChild(dt)
  row.appendChild(dd)
  return row
}

/** 用最新投影刷新账单区块内容（区块骨架已在贴装时建好）。 */
function renderBill(bill: HTMLElement): void {
  const doc = bill.ownerDocument
  if (!doc) return
  bill.textContent = ''

  const view = latestView
  const put = (el: HTMLElement): void => {
    bill.appendChild(el)
  }

  if (!view || !isOfficialDeepSeek(view.provider)) {
    // 非官方路由 / 无投影：什么都不贴（宁可不算，不算错）。
    return
  }

  if (view.available !== true) {
    const empty = doc.createElement('div')
    empty.className = 'meowcb_foot'
    empty.textContent = '喵账单：本会话暂无 Token 用量'
    put(empty)
    return
  }

  const cost = Number.isFinite(view.cost) ? (view.cost as number) : 0
  const missCost = Number.isFinite(view.missCost) ? (view.missCost as number) : 0
  const outputCost = Number.isFinite(view.outputCost) ? (view.outputCost as number) : 0
  const total = cost + missCost + outputCost
  const symbol = view.currency === 'USD' ? '$' : '¥'
  const tierText =
    typeof view.tier === 'string' && view.tier in TIER_LABEL ? TIER_LABEL[view.tier] : '估算'
  const hitRateText =
    view.hitRate !== null && view.hitRate !== undefined ? `${view.hitRate}%` : '—'

  const head = doc.createElement('div')
  head.className = 'meowcb_billhead'
  const title = doc.createElement('span')
  title.textContent = '当前轮消耗'
  const amount = doc.createElement('span')
  amount.className = 'meowcb_billtotal'
  amount.textContent = `${symbol}${formatAmount(total)}`
  head.appendChild(title)
  head.appendChild(amount)
  put(head)

  const rows = doc.createElement('div')
  rows.className = 'meowcb_bilrows'
  rows.appendChild(
    buildRow(doc, {
      color: '#34d399',
      label: '缓存命中',
      tokens: Number(view.cacheReadTokens ?? 0),
      amountText: `${symbol}${formatAmount(cost)}`,
    }),
  )
  rows.appendChild(
    buildRow(doc, {
      color: '#f59e0b',
      label: '缓存未命中',
      tokens: Math.max(0, Number(view.totalInputTokens ?? 0) - Number(view.cacheReadTokens ?? 0)),
      amountText: `${symbol}${formatAmount(missCost)}`,
    }),
  )
  rows.appendChild(
    buildRow(doc, {
      color: '#60a5fa',
      label: '输出',
      tokens: -1,
      amountText: `${symbol}${formatAmount(outputCost)}`,
    }),
  )
  put(rows)

  // 底部小字只保留峰/谷价标注——轮次/模型/命中率与网页最下方统计行重复
  // （2026-08-23 用户反馈砍掉）。
  const foot = doc.createElement('div')
  foot.className = 'meowcb_foot'
  foot.textContent = tierText
  put(foot)
}

/** 在官方弹层末尾贴上（或刷新）账单区块。 */
function ensureBill(panel: HTMLElement): void {
  let bill = panel.querySelector<HTMLElement>(':scope > .meowcb_bill')
  if (bill === null) {
    bill = panel.ownerDocument.createElement('div')
    bill.className = 'meowcb_bill'
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

/** 监听官方弹层出现：流式期间 mutation 频繁，这里只做轻量子树扫描，
 *  命中判定失败的开销是一次 aria-label 读取，可忽略。 */
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

/** 数据挂钩组件：props 由 slots 注入（useProjection 同官方条目）。
 *  渲染为零尺寸占位，仅保持投影订阅存活并把数据镜像进模块级 store。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CacheDataHook(props: any) {
  const data: CacheBillingView | undefined =
    typeof props.useProjection === 'function' ? props.useProjection('cacheBilling') : undefined

  ;(0, React.useEffect)(() => {
    latestView = data ?? undefined
    refreshOpenPanels()
  }, [data])

  return React.createElement('span', {
    'data-meow-cachebilling': 'hook',
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
    tag.dataset.plugin = 'meow-cachebilling'
    tag.dataset.pluginCss = CSS_ID
    tag.textContent = CSS
    document.head.appendChild(tag)
  }
  if (typeof document !== 'undefined') {
    startPanelBridge()
  }
  // 数据挂钩仍走 slots：拿到 slots 注入的 useProjection（同官方条目的取数通道）。
  ctx.slots.inject('conversation.input.right', () => {
    const dispose = ctx.slots.register(
      {
        name: 'conversation.input.right',
        id: 'meow-cachebilling-data-hook',
        order: 1,
      },
      CacheDataHook,
    )
    return () => {
      dispose()
    }
  })
}
