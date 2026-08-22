/**
 * meow-cachebilling — 喵账单（浏览器端）。
 *
 * 在输入框下方官方统计条（conversation.composer.dock 的 stats 条目）旁边
 * 注册一个 dock 读数：「本轮缓存 ¥x.xxxx」。
 *
 * - 数据来自 host 投影 cacheBilling（useProjection 直读，随 mux 帧
 *   实时到达，零轮询）。
 * - 只显示当前轮：host 端每个新 step 直接覆盖上一轮。
 * - 仅 DeepSeek 官方路由显示：第三方网关（SiliconFlow 等）价格表不同，
 *   provider 判定不过就整体隐藏——宁可不算，不算错。
 * - 悬停明细：命中 token 数 × 单价（含峰/谷/平价标注），算得明明白白。
 */

import * as React from 'react'

/** 样式注入标识（防重复注入）。 */
const CSS_ID = 'meow-cachebilling-css'

/** 读数样式：与官方统计条同宽同字号（StatsLine 同款盒模型），右对齐。 */
const CSS = `
.meowcb_root{display:flex;align-items:center;justify-content:flex-end;box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width);padding:2px calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;margin:0 auto;font-size:12px;line-height:20px}
.meowcb_amount{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
`

/** 仅 DeepSeek 官方路由显示。真实 provider 字符串值由 host probe 日志校准；
 *  当前口径：名字含 deepseek 即视为官方（第三方网关一般以自家名作 provider，
 *  模型名才带 deepseek 字样）。校准后收紧为精确匹配。 */
function isOfficialDeepSeek(provider: unknown): boolean {
  if (typeof provider !== 'string' || provider === '') return false
  return provider.toLowerCase().includes('deepseek')
}

/** 金额数字格式化（无货币符号）：≥0.01 保留两位；<0.01 全保留实际小数位
 *  不补零——开局缓存花销可能便宜到 0.000012，截断就没法看了。 */
function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0'
  if (amount < 0.01) {
    return amount.toFixed(9).replace(/(\.\d{2}\d*?)0+$/, '$1').replace(/\.$/, '')
  }
  return amount.toFixed(2)
}

/** 带货币符号版本。 */
function formatCost(amount: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : '¥'
  return `${symbol}${formatAmount(amount)}`
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
  hitRate?: number | null
  model?: string | null
  provider?: string | null
  tier?: string | null
  unitPricePerM?: number | null
  turn?: number | null
  step?: number | null
}

/** dock 条目组件：props 由 slots 注入（useProjection/t 等，同 StatsLine）。
 *  只要拿到投影就渲染：命中显示金额，未命中明说"¥0 本轮未命中"——
 *  消失比零更像坏了。仅非官方 provider 才整体隐藏。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CacheReadout(props: any) {
  const data: CacheBillingView | undefined =
    typeof props.useProjection === 'function' ? props.useProjection('cacheBilling') : undefined

  if (data === undefined || data === null) {
    return React.createElement(
      'div',
      { className: 'meowcb_root', title: 'useProjection("cacheBilling") 为空——host 投影未注册' },
      React.createElement('span', { key: 'text' }, '喵账单：无投影数据'),
    )
  }
  if (!isOfficialDeepSeek(data.provider)) {
    // 非官方路由：价格表不适用，直接不显示（2026-08-22 用户拍板）
    return null
  }

  const cost = Number.isFinite(data.cost) ? (data.cost as number) : 0
  const missCost = Number.isFinite(data.missCost) ? (data.missCost as number) : 0
  const outputCost = Number.isFinite(data.outputCost) ? (data.outputCost as number) : 0
  const tierText =
    typeof data.tier === 'string' && data.tier in TIER_LABEL ? TIER_LABEL[data.tier] : '估算'
  const unit =
    typeof data.unitPricePerM === 'number' ? `¥${data.unitPricePerM}/M` : '单价未知'
  const cur = data.currency ?? 'CNY'
  const detail = [
    `当前轮（turn ${data.turn ?? '?'} / step ${data.step ?? '?'}）`,
    `缓存 ${formatTokens(data.cacheReadTokens ?? 0)} tok × ${unit}（${tierText}）`,
    `模型 ${data.model ?? '未知'}`,
    `命中率 ${data.hitRate !== null && data.hitRate !== undefined ? `${data.hitRate}%` : '—'}`,
    `原始投影 ${JSON.stringify(data).slice(0, 220)}`,
  ].join(' · ')

  // 四项常驻：总价突出在前，三分项跟随（用户拍板的排版）
  const total = cost + missCost + outputCost
  const text =
    data.available === true
      ? `本轮 ${formatCost(total, cur)}｜缓存 ${formatAmount(cost)} · 未命中 ${formatAmount(missCost)} · 输出 ${formatAmount(outputCost)}`
      : '喵账单：本会话暂无 Token 用量'

  return React.createElement(
    'div',
    { className: 'meowcb_root', title: detail },
    React.createElement('span', { key: 'text' }, text),
  )
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
  // 等待 ui-conversation 声明 composer.dock 槽位后再注册本条目。
  ctx.slots.inject('conversation.composer.dock', () => {
    const dispose = ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'meow-cachebilling',
        order: 1,
      },
      CacheReadout,
    )
    return () => {
      dispose()
    }
  })
}
