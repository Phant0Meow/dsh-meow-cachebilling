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

/** 账单区块样式：排版语言复刻官方弹层，顶部细分隔线与官方 rows 区隔。层级：标题（色块+默认大字）> 子项（11px 小字）；账表/右列数据全小字，SVG 内 9px。 */
const CSS = `
.meowcb_bill{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3)}
.meowcb_grid{display:grid;grid-template-columns:max-content 1fr 1fr 1fr 1fr;column-gap:10px;row-gap:2px;margin-top:4px;align-items:baseline;font-size:10px;line-height:14px;text-align:center}
.meowcb_lab{color:var(--dsw-alias-label-secondary);font-weight:400;white-space:nowrap}
.meowcb_t{color:var(--dsw-alias-label-primary);font-weight:500;font-variant-numeric:tabular-nums}
.meowcb_h{color:var(--dsw-alias-label-secondary);font-weight:400;text-align:center;white-space:nowrap}
.meowcb_v{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:500;text-align:center}
.meowcb_sechead{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);margin:2px 0;font-size:12px;line-height:20px}
.meowcb_secheadsw{width:8px;height:8px;border-radius:2px;flex:none}
.meowcb_subhead{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px;font-weight:700}
.meowcb_modeline{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}
.meowcb_foot{margin-top:6px;color:var(--dsw-alias-label-caption);font-size:10px;line-height:14px}
.meowcb_notice{color:#f59e0b;font-size:10px;line-height:14px}
.meowcb_chartwrap{display:flex;gap:12px;align-items:center;margin-top:4px}
.meowcb_chartcol{flex:none;width:124px}
.meowcb_chartside{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.meowcb_svg{display:block;width:100%;height:auto}
.meowcb_axis{stroke:var(--dsw-alias-border-l3);stroke-width:1}
.meowcb_avg{stroke:#60a5fa;stroke-width:1.5;fill:none}
.meowcb_cur{stroke:#f59e0b;stroke-width:1.5;fill:none}
.meowcb_dotavg{fill:#60a5fa}
.meowcb_dotcur{fill:#f59e0b}
.meowcb_axlabel{fill:var(--dsw-alias-label-caption);font-size:9px}
.meowcb_cmplab{color:var(--dsw-alias-label-secondary);white-space:nowrap;display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-size:10px;line-height:14px}
.meowcb_cmpv{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:500}

/* 手机矮视口适配：官方弹层 bottom 锚定向上生长且无高度上限（桌面假设），贴入账单后在手机竖屏会顶出屏幕外；
   同理 width 写死 264px，折叠屏折叠态外屏 CSS 视口更窄（<264px+边距）时弹层左缘整体被推出屏幕左缘外。
   按属性选择器双语匹配官方弹层（同 startPanelBridge 的判定口径，不硬编码官方 CSS modules hash 类名）。
   max-height/max-width 是 JS 失效时的兜底（先 vh/vw 再 dvh/dvw）；text-size-adjust 顺带拦掉安卓 text autosizing——
   字体提升会把 10px 小字放大，横竖两头挤爆 5 列账表。 */
[role="dialog"][aria-label*="上下文已用"],
[role="dialog"][aria-label*="of context used"] {
  max-height: calc(100vh - 140px);
  max-height: calc(100dvh - 140px);
  max-width: calc(100vw - 20px);
  max-width: calc(100dvw - 20px);
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
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
  /** 消耗比较块（第三块）：null = 尚无用量样本 */
  compare?: {
    readCode: number
    cache: number
    fullMiss: number
  } | null
}

/** 小节标题：色块 + 默认大字（标题层级，子项一律小字），renderBill 与 renderChart 共用。 */
function secHead(doc: Document, color: string, text: string): HTMLElement {
  const head = doc.createElement('div')
  head.className = 'meowcb_sechead'
  const sw = doc.createElement('span')
  sw.className = 'meowcb_secheadsw'
  sw.style.background = color
  head.appendChild(sw)
  head.appendChild(doc.createTextNode(text))
  return head
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

  // 未命中价目表的醒目提示行仍在最顶：金额是 flash 价估算，不能穿着精确数据的外衣
  if (view.priceMatched === false) {
    const notice = doc.createElement('div')
    notice.className = 'meowcb_notice'
    notice.textContent =
      '［喵缓存账单］当前模型无价格数据，请去设置界面添加。以下为Deepseek价格，仅供参考：'
    put(notice)
  }

  // 账表节标题：色块 + 大字（猫猫 08-31 层级定稿：标题大字、子项小字）
  put(secHead(doc, '#f59e0b', '当前会话统计'))

  // 账表：5 列无边框 grid——首列=行标签（列头「消耗(¥)」标货币单位），总价独立一列，右边三列=缓存命中/缓存未命中/输出。金额右对齐，天然对齐不画线。
  const grid = doc.createElement('div')
  grid.className = 'meowcb_grid'
  const cell = (className: string, text: string): void => {
    const el = doc.createElement('div')
    el.className = className
    el.textContent = text
    grid.appendChild(el)
  }
  cell('meowcb_lab', `消耗(${symbol})`)
  cell('meowcb_h', '总价')
  cell('meowcb_h', '缓存命中')
  cell('meowcb_h', '缓存未命中')
  cell('meowcb_h', '输出')
  const tableRow = (label: string, total: number, hit: number, miss: number, out: number): void => {
    cell('meowcb_lab', label)
    cell('meowcb_v', formatAmount(total))
    cell('meowcb_v', formatAmount(hit))
    cell('meowcb_v', formatAmount(miss))
    cell('meowcb_v', formatAmount(out))
  }
  tableRow('一步', cost + missCost + outputCost, cost, missCost, outputCost)

  // 一轮：turn 内多步累计
  const turnHit = Number.isFinite(view.turnHitCost) ? (view.turnHitCost as number) : 0
  const turnMiss = Number.isFinite(view.turnMissCost) ? (view.turnMissCost as number) : 0
  const turnOut = Number.isFinite(view.turnOutputCost) ? (view.turnOutputCost as number) : 0
  tableRow('一轮', turnHit + turnMiss + turnOut, turnHit, turnMiss, turnOut)

  // 会话累计
  const sessionHit = Number.isFinite(view.sessionCacheHitCost) ? (view.sessionCacheHitCost as number) : 0
  const sessionMiss = Number.isFinite(view.sessionMissCost) ? (view.sessionMissCost as number) : 0
  const sessionOut = Number.isFinite(view.sessionOutputCost) ? (view.sessionOutputCost as number) : 0
  tableRow('会话', sessionHit + sessionMiss + sessionOut, sessionHit, sessionMiss, sessionOut)
  put(grid)

  // 块 2+3 合并布局：标题横贯顶部（provider/model，峰谷带括号），左=竖长方形曲线（图例画图内），右=「消耗比较」+「缓存」两节——失效统计从表下小字搬入右列，底部灰字删除（猫猫 08-31 定稿）。
  renderChart(doc, put, view)
}

/** 块 2+3 合并布局（猫猫 2026-08-31 定稿）：标题横贯顶部「对于 provider/model」（峰谷带括号：官方梁文峰/梁文谷、其他峰价/谷价；一口价不加括号），底部灰字删除。左半边竖长方形手写 SVG——图例（─ 平均 / ─ 本会话）竖排画在图内左上，轴标签紧凑贴边；右半边两节：「■ 消耗比较」三数 + 「■ 缓存」失效统计（完全失效次数；缓存时间估算/现在失效可能先占位留空）。curve 与 compare 任一存在即渲染，估算场景 curve 为 null 只出右列。 */
function renderChart(doc: Document, put: (el: HTMLElement) => void, view: CacheBillingView): void {
  const curve = view.curve
  const cmp = view.compare
  if (!curve && !cmp) return

  // 顶部标题：色块 + 大字「当前模型统计」（猫猫 09-01 定稿）；模型信息另起一行小字，峰谷标注跟在模型名后（一口价不加）
  const official = isOfficialDeepSeek(view.provider)
  const labels = official ? TIER_LABEL : TIER_LABEL_GENERIC
  const modelPart = typeof view.model === 'string' && view.model !== '' ? view.model : '当前模型'
  const namePart =
    typeof view.provider === 'string' && view.provider !== '' ? `${view.provider}/${modelPart}` : modelPart
  const tierWord =
    view.tier === 'peak' ? labels.peak : view.tier === 'offPeak' ? labels.offPeak : null
  put(secHead(doc, '#60a5fa', '当前模型统计'))
  const modeline = doc.createElement('div')
  modeline.className = 'meowcb_modeline'
  modeline.textContent = tierWord ? `${namePart} · ${tierWord}` : namePart
  put(modeline)

  const wrap = doc.createElement('div')
  wrap.className = 'meowcb_chartwrap'

  // 左列：竖长方形曲线图（仅价目表命中时画——估算步不入曲线）
  if (curve) {
    const col = doc.createElement('div')
    col.className = 'meowcb_chartcol'

    const W = 120
    const H = 130
    const L = 8
    const R = 6
    const TOP = 2 // 曲线区顶到图边（去掉顶部留白，猫猫 09-01）；留 2px 防曲线端点圆被 viewBox 裁切
    const B = 10
    const lastCurN = curve.cur.length > 0 ? curve.cur[curve.cur.length - 1][0] : 0
    const xmax = Math.max(curve.avg.length, lastCurN, 1)
    let ymax = 0
    for (const v of curve.avg) if (v > ymax) ymax = v
    for (const [, v] of curve.cur) if (v > ymax) ymax = v
    if (ymax <= 0) ymax = 1
    const x = (n: number): number => L + ((n - 1) / Math.max(xmax - 1, 1)) * (W - L - R)
    const y = (v: number): number => H - B - (v / ymax) * (H - B - TOP)
    const NS = 'http://www.w3.org/2000/svg'
    const el = (tag: string, cls: string): SVGElement => {
      const node = doc.createElementNS(NS, tag)
      node.setAttribute('class', cls)
      return node as unknown as SVGElement
    }

    const svg = el('svg', 'meowcb_svg')
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)

    // 图例浮在图内左上角（二次增长曲线左上恒空，正好放）——猫猫：平均后面不要写几轮
    const legendLine = (cls: string, cy: number, text: string): void => {
      const line = el('line', cls)
      line.setAttribute('x1', '6')
      line.setAttribute('y1', String(cy))
      line.setAttribute('x2', '14')
      line.setAttribute('y2', String(cy))
      svg.appendChild(line)
      const label = el('text', 'meowcb_axlabel')
      label.setAttribute('x', '17')
      label.setAttribute('y', String(cy + 3))
      label.textContent = text
      svg.appendChild(label)
    }
    legendLine('meowcb_avg', 24, '平均')
    legendLine('meowcb_cur', 35, '本会话')

    // L 形坐标轴：左纵 + 下横，紧凑贴边
    const axisY = el('line', 'meowcb_axis')
    axisY.setAttribute('x1', String(L))
    axisY.setAttribute('y1', String(TOP))
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

    // Y 轴金额：图内左上角、Y 轴右侧（在 Y 轴高度范围内）；图例两行排其下
    const yLabel = el('text', 'meowcb_axlabel')
    yLabel.setAttribute('x', String(L + 4))
    yLabel.setAttribute('y', '12')
    yLabel.textContent = `¥${formatAmount(ymax)}`
    const xLabel = el('text', 'meowcb_axlabel')
    xLabel.setAttribute('x', String(W - R))
    xLabel.setAttribute('y', String(H - 2))
    xLabel.setAttribute('text-anchor', 'end')
    xLabel.textContent = `${xmax} 步`
    svg.appendChild(yLabel)
    svg.appendChild(xLabel)
    col.appendChild(svg as unknown as HTMLElement)
    wrap.appendChild(col)
  }

  // 右列：两节小节标题=小字加粗无色块（猫猫 09-01 定稿），「缓存」节前空一行
  const side = doc.createElement('div')
  side.className = 'meowcb_chartside'
  const subHead = (text: string, gapBefore?: boolean): HTMLElement => {
    const head = doc.createElement('div')
    head.className = 'meowcb_subhead'
    if (gapBefore) head.style.marginTop = '14px'
    head.textContent = text
    return head
  }
  if (cmp) {
    side.appendChild(subHead('消耗比较'))
    const item = (label: string, hint: string, value: number): void => {
      const row = doc.createElement('div')
      row.className = 'meowcb_cmplab'
      row.title = hint
      const lab = doc.createElement('span')
      lab.textContent = label
      row.appendChild(lab)
      const num = doc.createElement('span')
      num.className = 'meowcb_cmpv'
      num.textContent = formatAmount(value)
      row.appendChild(num)
      side.appendChild(row)
    }
    item(
      '读代码',
      '前两轮的所有MISS输入，AI 一般会在前两轮大量、集中地读取项目代码。这个数据衡量了你新开窗口后，AI 重读代码的消耗。',
      cmp.readCode,
    )
    item('缓存', '当前每次API请求的缓存命中价格。', cmp.cache)
    item('缓存失效', '如果服务器缓存已失效，本窗口上下文全按MISS算的价格。', cmp.fullMiss)

    side.appendChild(subHead('缓存', true))
    const statRow = (label: string, value: string, hint?: string): void => {
      const row = doc.createElement('div')
      row.className = 'meowcb_cmplab'
      if (hint) row.title = hint
      const lab = doc.createElement('span')
      lab.textContent = label
      row.appendChild(lab)
      const num = doc.createElement('span')
      num.className = 'meowcb_cmpv'
      num.textContent = value
      row.appendChild(num)
      side.appendChild(row)
    }
    // 完全失效：有输入但缓存命中为 0（官方路由也可靠推导）；缓存失效次数：写入即失效，仅部分中转报值
    const fullMissSteps = Number.isFinite(view.sessionFullMissSteps)
      ? (view.sessionFullMissSteps as number)
      : 0
    statRow('完全失效次数', `${fullMissSteps} 次`, '有输入但缓存命中为 0 的调用次数，任何路由都可靠')
    const missSteps = Number.isFinite(view.sessionMissSteps) ? (view.sessionMissSteps as number) : 0
    if (missSteps > 0) {
      statRow(
        '缓存失效次数',
        `${missSteps} 次`,
        '发生过缓存写入的调用次数，写入即前缀变更；官方 API 不报此字段，仅部分中转有值',
      )
    }
    // 猫猫预留位：数据源口径待定义，先明示「暂未实现」（2026-09-01 猫猫要求）
    statRow('缓存时间估算', '暂未实现')
    statRow('现在失效可能', '暂未实现')
  }
  wrap.appendChild(side)
  put(wrap)
}

/** 手机窄/矮视口适配（精确版）：官方弹层 bottom+right 锚定、尺寸写死（width 264px、无高度上限），小视口（手机竖屏/折叠屏折叠态/分屏窗格）放不下时超出屏幕。兜底 CSS 按视口估算，这里用真实几何修正——①maxWidth/maxHeight 按 visualViewport 实测设置；②横向如仍超出可视区（锚点被页面横向溢出带出屏外的场景），用 translateX 平移回屏内，纯视觉平移不影响布局。大屏放得下时所有修正都不触发，桌面与 iPhone 现状不变。 */
function fitPanel(panel: HTMLElement): void {
  // 先清上次平移再测量，避免 rect 叠加旧位移导致重算漂移
  panel.style.transform = ''
  const visual = typeof window !== 'undefined' ? window.visualViewport : null
  const viewportWidth = visual ? visual.width : window.innerWidth
  // 尺寸上限：先设宽度再测量，rect 即反映缩窄后的几何（bottom 锚定下限高不改 rect.bottom）
  panel.style.maxWidth = `${Math.floor(viewportWidth - 16)}px`
  const rect = panel.getBoundingClientRect()
  const room = rect.bottom - (visual ? visual.offsetTop : 0) - 8
  if (Number.isFinite(room) && room > 0) {
    panel.style.maxHeight = `${Math.floor(room)}px`
  }
  // 横向钳制：超出可视区左右缘时平移回屏内
  const viewportLeft = visual ? visual.offsetLeft : 0
  let dx = 0
  if (rect.right > viewportLeft + viewportWidth - 8) {
    dx = viewportLeft + viewportWidth - 8 - rect.right
  }
  if (rect.left + dx < viewportLeft + 8) {
    dx = viewportLeft + 8 - rect.left
  }
  panel.style.transform = dx !== 0 ? `translateX(${Math.round(dx)}px)` : ''
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
  fitPanel(panel)
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
  // 手机上地址栏收展/旋转会改变可视区高度，弹层的精确上限跟着重算（refreshOpenPanels 内部会顺带 fit）
  const onViewportResize = (): void => refreshOpenPanels()
  window.visualViewport?.addEventListener('resize', onViewportResize)
  return () => {
    observer.disconnect()
    window.visualViewport?.removeEventListener('resize', onViewportResize)
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
    'data-meowcb-version': 'cmp-19',
    style: { display: 'none' },
  })
}

export const inject = ['slots', 'connection', 'remote', 'settingsScope', 'settingsSchema']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: any): void {
  // 版本标记：排障用，每次改动 bump——rev 滞后时看控制台标记就知道浏览器跑的是哪一版
  console.log('[meow-cachebilling] client bundle: cmp-19')
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
