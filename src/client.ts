/**
 * meow-cachebilling — 缓存账单浏览器端。
 *
 * 不再自带任何按钮或占位行：官方上下文圆环点开的弹层本来就是「这个会话用了多少」的语义，缓存账单的「这步花了多少、要不要换窗口」语义与之天然同源，用户拍板就该放到那里。因此监听官方弹层的打开，把账单区块直接贴进去。
 *
 * - CacheDataHook：仍经 slots 挂在 conversation.input.right 不可见处，唯一职责是让 useProjection 保持活跃，把最新投影同步进模块级 store 并刷新已打开的弹层区块。
 * - ContextPanelBridge：MutationObserver 观察官方弹层出现，role=dialog 且 aria-label 为「上下文已用 / of context used」，出现即在弹层末尾贴上账单区块，弹层关闭随 React 卸载自然消失。
 * - 第三方中转同样显示：provider 非空即放行；DeepSeek 官方路由（provider 名含 deepseek，沿用旧口径）按刊例价精确计价，第三方模型命中价目表按刊例价计、未命中按 flash 价估算并标注，provider 为空时不显示。
 * - 已知边界：官方若更改弹层结构或文案，贴装会静默失效，菜单里少了账单行，不影响其他功能，届时适配新选择器即可。
 */

import * as React from 'react'
import { applySettings } from './settings'

/** 样式注入标识（防重复注入）。 */
const CSS_ID = 'meow-cachebilling-css'

/** 账单区块样式：排版语言复刻官方弹层，顶部细分隔线与官方 rows 区隔。账表用无边框 CSS grid——等宽列加金额右对齐，天然成表不画线。 */
const CSS = `
.meowcb_bill{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3)}
.meowcb_grid{display:grid;grid-template-columns:max-content 1fr 1fr 1fr;column-gap:10px;row-gap:2px;margin-top:4px;align-items:baseline}
.meowcb_lab{color:var(--dsw-alias-label-secondary);font-weight:400;white-space:nowrap}
.meowcb_t{color:var(--dsw-alias-label-primary);font-weight:500;font-variant-numeric:tabular-nums}
.meowcb_h{color:var(--dsw-alias-label-secondary);font-weight:400;text-align:right;white-space:nowrap}
.meowcb_v{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:500;text-align:right}
.meowcb_swatch{border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block;flex:none}
.meowcb_stat{display:flex;align-items:center;margin-top:4px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.meowcb_foot{margin-top:6px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.meowcb_notice{color:#f59e0b;font-size:11px;line-height:16px}
.meowcb_chart{margin-top:8px}
.meowcb_charthead{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.meowcb_svg{display:block;width:100%;height:auto}
.meowcb_axis{stroke:var(--dsw-alias-border-l3);stroke-width:1}
.meowcb_avg{stroke:#60a5fa;stroke-width:1.5;fill:none}
.meowcb_cur{stroke:#f59e0b;stroke-width:1.5;fill:none}
.meowcb_dotavg{fill:#60a5fa}
.meowcb_dotcur{fill:#f59e0b}
.meowcb_axlabel{fill:var(--dsw-alias-label-caption);font-size:9px}
.meowcb_legend{display:flex;gap:12px;align-items:center;margin-top:2px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.meowcb_sw{display:inline-block;width:10px;height:2px;margin-right:4px;vertical-align:middle}
.meowcb_sw-avg{background:#60a5fa}
.meowcb_sw-cur{background:#f59e0b}
`

/** 显示判定：默认全生效，不再按 provider 名过滤。任何 provider 只要报出用量，就按模型名匹配价目表显示估算金额，provider 为空时不显示。 */
function isBillableProvider(provider: unknown): boolean {
  return typeof provider === 'string' && provider !== ''
}

/** 金额格式化，无货币符号：小于 0.01 四舍五入保留一位有效数字（0.0047→0.005，0.0003 依稀可辨），大于等于 0.01 四舍五入到分，0 恒显示 0。 */
function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0'
  if (amount >= 0.01) return amount.toFixed(2)
  // 一位有效数字：数量级 exp + 首位 sig，四舍五入进位到 10 时升一级数量级（0.0096 → 0.01）
  let exp = Math.floor(Math.log10(amount))
  let sig = Math.round(amount / Math.pow(10, exp))
  if (sig >= 10) {
    exp += 1
    sig = 1
  }
  const value = sig * Math.pow(10, exp)
  return value >= 0.01 ? value.toFixed(2) : value.toFixed(-exp)
}

const TIER_LABEL: Record<string, string> = {
  peak: '梁文峰',
  offPeak: '梁文谷',
}

/** 非 DeepSeek 官方路由的峰谷标注：直白写峰价/谷价，彩蛋只留给官方路由（口径沿用旧版：provider 名含 deepseek 即视为官方）。 */
const TIER_LABEL_GENERIC: Record<string, string> = {
  peak: '峰价',
  offPeak: '谷价',
}

/** 是否 DeepSeek 官方路由：provider 名含 deepseek 即视为官方，第三方网关一般以自家名作 provider，模型名才带 deepseek 字样。 */
function isOfficialDeepSeek(provider: unknown): boolean {
  if (typeof provider !== 'string' || provider === '') return false
  return provider.toLowerCase().includes('deepseek')
}

interface CacheBillingView {
  available?: boolean
  cost?: number
  missCost?: number
  outputCost?: number
  currency?: string
  model?: string | null
  provider?: string | null
  tier?: string | null
  priceMatched?: boolean
  sessionMissSteps?: number
  sessionFullMissSteps?: number
  turnHitCost?: number
  turnMissCost?: number
  turnOutputCost?: number
  sessionCacheHitCost?: number
  sessionMissCost?: number
  sessionOutputCost?: number
  /** 曲线块（第二块）：null = 当前模型未命中价目表（估算步不入曲线） */
  curve?: {
    key: string
    sessions: number
    avg: number[]
    cur: Array<[number, number]>
  } | null
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
    empty.className = 'meowcb_foot'
    empty.textContent = '缓存账单：本会话暂无 Token 用量'
    put(empty)
    return
  }

  const cost = Number.isFinite(view.cost) ? (view.cost as number) : 0
  const missCost = Number.isFinite(view.missCost) ? (view.missCost as number) : 0
  const outputCost = Number.isFinite(view.outputCost) ? (view.outputCost as number) : 0
  const symbol = view.currency === 'USD' ? '$' : '¥'
  const official = isOfficialDeepSeek(view.provider)
  const modelSuffix = typeof view.model === 'string' && view.model !== '' ? ` · ${view.model}` : ''
  const labels = official ? TIER_LABEL : TIER_LABEL_GENERIC
  // 命中价目表：tier 标签（峰谷/一口价）；未命中：金额是 flash 价兜底估算——明示责任交给块 1 上方的醒目提示行，底部不再标（估算）
  const tierLabel = typeof view.tier === 'string' && view.tier in labels ? labels[view.tier] : '一口价'
  const tierText = `${tierLabel}${modelSuffix}`

  // 未命中价目表的醒目提示行仍在表上方：金额是 flash 价估算，不能穿着精确数据的外衣
  if (view.priceMatched === false) {
    const notice = doc.createElement('div')
    notice.className = 'meowcb_notice'
    notice.textContent =
      '［喵缓存账单］当前模型无价格数据，请去设置界面添加。以下为Deepseek价格，仅供参考：'
    put(notice)
  }

  // 账表：首列=行标签加该级总价（中间一个空格，货币单位只在表头标一次），右边三列=缓存命中/缓存未命中/输出明细。无边框 grid，金额右对齐，天然对齐不画线。
  const grid = doc.createElement('div')
  grid.className = 'meowcb_grid'
  const cell = (className: string, text: string): void => {
    const el = doc.createElement('div')
    el.className = className
    el.textContent = text
    grid.appendChild(el)
  }
  cell('meowcb_lab', `当前 总价(${symbol})`)
  cell('meowcb_h', '缓存命中')
  cell('meowcb_h', '缓存未命中')
  cell('meowcb_h', '输出')
  const tableRow = (label: string, hit: number, miss: number, out: number): void => {
    const lab = doc.createElement('div')
    lab.className = 'meowcb_lab'
    lab.appendChild(doc.createTextNode(label))
    lab.appendChild(doc.createTextNode(' '))
    const t = doc.createElement('span')
    t.className = 'meowcb_t'
    t.textContent = formatAmount(hit + miss + out)
    lab.appendChild(t)
    grid.appendChild(lab)
    cell('meowcb_v', formatAmount(hit))
    cell('meowcb_v', formatAmount(miss))
    cell('meowcb_v', formatAmount(out))
  }
  tableRow('一步', cost, missCost, outputCost)

  // 一轮：turn 内多步累计
  const turnHit = Number.isFinite(view.turnHitCost) ? (view.turnHitCost as number) : 0
  const turnMiss = Number.isFinite(view.turnMissCost) ? (view.turnMissCost as number) : 0
  const turnOut = Number.isFinite(view.turnOutputCost) ? (view.turnOutputCost as number) : 0
  tableRow('一轮', turnHit, turnMiss, turnOut)

  // 会话累计
  const sessionHit = Number.isFinite(view.sessionCacheHitCost) ? (view.sessionCacheHitCost as number) : 0
  const sessionMiss = Number.isFinite(view.sessionMissCost) ? (view.sessionMissCost as number) : 0
  const sessionOut = Number.isFinite(view.sessionOutputCost) ? (view.sessionOutputCost as number) : 0
  tableRow('会话', sessionHit, sessionMiss, sessionOut)
  put(grid)

  // 缓存失效统计：写入即失效，仅部分中转报值；完全失效，任何路由可靠。小字状态行放表下，仅发生时出现。
  const missSteps = Number.isFinite(view.sessionMissSteps) ? (view.sessionMissSteps as number) : 0
  const fullMissSteps = Number.isFinite(view.sessionFullMissSteps)
    ? (view.sessionFullMissSteps as number)
    : 0
  const statRow = (color: string, text: string): void => {
    const el = doc.createElement('div')
    el.className = 'meowcb_stat'
    const swatch = doc.createElement('span')
    swatch.className = 'meowcb_swatch'
    swatch.style.background = color
    el.appendChild(swatch)
    el.appendChild(doc.createTextNode(text))
    put(el)
  }
  if (missSteps > 0) statRow('#fb7185', `缓存失效 ${missSteps} 次`)
  if (fullMissSteps > 0) statRow('#f43f5e', `完全失效 ${fullMissSteps} 次`)

  // 底部小字只保留峰谷价标注附模型名，轮次、模型、命中率与网页最下方统计行重复，用户反馈砍掉。
  const foot = doc.createElement('div')
  foot.className = 'meowcb_foot'
  foot.textContent = tierText
  put(foot)

  // 块 2：平均累计花费曲线——平均看「这种模型这种价通常怎么涨」，本会话看「我现在实际怎么涨」，对照斜率赶在起飞前换窗。
  renderCurve(doc, put, view)
}

/** 块 2：平均累计花费曲线。手写 SVG——L 形极简坐标轴（无边线的延续）+ 平均/本会话两条折线 + 端点圆点。 */
function renderCurve(doc: Document, put: (el: HTMLElement) => void, view: CacheBillingView): void {
  const curve = view.curve
  if (!curve) return
  const tierLabel = view.tier === 'peak' ? '峰价' : view.tier === 'offPeak' ? '谷价' : '一口价'
  const heading = doc.createElement('div')
  heading.className = 'meowcb_charthead'
  heading.textContent = `对于 ${view.model ?? '当前模型'}（${tierLabel}）：`
  put(heading)

  const W = 280
  const H = 110
  const L = 40
  const R = 10
  const T = 10
  const B = 18
  const lastCurN = curve.cur.length > 0 ? curve.cur[curve.cur.length - 1][0] : 0
  const xmax = Math.max(curve.avg.length, lastCurN, 1)
  let ymax = 0
  for (const v of curve.avg) if (v > ymax) ymax = v
  for (const [, v] of curve.cur) if (v > ymax) ymax = v
  if (ymax <= 0) ymax = 1
  const x = (n: number): number => L + ((n - 1) / Math.max(xmax - 1, 1)) * (W - L - R)
  const y = (v: number): number => H - B - (v / ymax) * (H - B - T)
  const NS = 'http://www.w3.org/2000/svg'
  const el = (tag: string, cls: string): SVGElement => {
    const node = doc.createElementNS(NS, tag)
    node.setAttribute('class', cls)
    return node as unknown as SVGElement
  }

  const svg = el('svg', 'meowcb_svg')
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  // L 形坐标轴：左纵 + 下横，无边框美学的极简延续
  const axisY = el('line', 'meowcb_axis')
  axisY.setAttribute('x1', String(L))
  axisY.setAttribute('y1', String(T))
  axisY.setAttribute('x2', String(L))
  axisY.setAttribute('y2', String(H - B))
  const axisX = el('line', 'meowcb_axis')
  axisX.setAttribute('x1', String(L))
  axisX.setAttribute('y1', String(H - B))
  axisX.setAttribute('x2', String(W - R))
  axisX.setAttribute('y2', String(H - B))
  svg.appendChild(axisY)
  svg.appendChild(axisX)

  // 平均累计曲线（步 1..N 稠密）
  if (curve.avg.length > 0) {
    const line = el('polyline', 'meowcb_avg')
    line.setAttribute('points', curve.avg.map((v, i) => `${x(i + 1)},${y(v)}`).join(' '))
    svg.appendChild(line)
    const dot = el('circle', 'meowcb_dotavg')
    dot.setAttribute('cx', String(x(curve.avg.length)))
    dot.setAttribute('cy', String(y(curve.avg[curve.avg.length - 1])))
    dot.setAttribute('r', '2')
    svg.appendChild(dot)
  }

  // 本会话实际累计曲线（全部精确步，x 落在真实调用序号上，混模型也如实）
  if (curve.cur.length > 0) {
    const line = el('polyline', 'meowcb_cur')
    line.setAttribute('points', curve.cur.map(([n, v]) => `${x(n)},${y(v)}`).join(' '))
    svg.appendChild(line)
    const dot = el('circle', 'meowcb_dotcur')
    dot.setAttribute('cx', String(x(curve.cur[curve.cur.length - 1][0])))
    dot.setAttribute('cy', String(y(curve.cur[curve.cur.length - 1][1])))
    dot.setAttribute('r', '2')
    svg.appendChild(dot)
  }

  // 轴端标注：左上 Y 上限，右下 X 总步数
  const yLabel = el('text', 'meowcb_axlabel')
  yLabel.setAttribute('x', String(L + 4))
  yLabel.setAttribute('y', String(T + 2))
  yLabel.textContent = `¥${formatAmount(ymax)}`
  const xLabel = el('text', 'meowcb_axlabel')
  xLabel.setAttribute('x', String(W - R))
  xLabel.setAttribute('y', String(H - 4))
  xLabel.setAttribute('text-anchor', 'end')
  xLabel.textContent = `${xmax} 步`
  svg.appendChild(yLabel)
  svg.appendChild(xLabel)
  put(svg as unknown as HTMLElement)

  const legend = doc.createElement('div')
  legend.className = 'meowcb_legend'
  const items: Array<[string, string]> = [
    ['meowcb_sw-avg', curve.sessions > 0 ? `平均 · ${curve.sessions} 个会话` : '平均 · 暂无样本'],
    ['meowcb_sw-cur', '本会话'],
  ]
  for (const [cls, text] of items) {
    const item = doc.createElement('span')
    const sw = doc.createElement('span')
    sw.className = `meowcb_sw ${cls}`
    item.appendChild(sw)
    item.appendChild(doc.createTextNode(text))
    legend.appendChild(item)
  }
  put(legend)
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
    'data-meow-cachebilling': 'hook',
    'data-meowcb-version': 'curve-1',
    style: { display: 'none' },
  })
}

export const inject = ['slots', 'connection', 'remote', 'settingsScope', 'settingsSchema']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: any): void {
  // 版本标记：排障用，每次改动 bump——rev 滞后时看控制台标记就知道浏览器跑的是哪一版
  console.log('[meow-cachebilling] client bundle: curve-1')
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
  // 数据挂钩仍走 slots：拿到 slots 注入的 useProjection，同官方条目的取数通道。
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
  // 设置页模块（独立文件 src/settings.ts，不掺和账单渲染）：探针阶段失败也只警告，绝不影响账单。
  try {
    applySettings(ctx)
  } catch (e) {
    console.warn('[meow-cachebilling] 设置页注册失败（不影响账单）：', e)
  }
}
