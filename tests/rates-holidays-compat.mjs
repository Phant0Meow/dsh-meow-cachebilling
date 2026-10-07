/**
 * 价目匹配 × 节假日扣除 × 历史桶归并 测试（issue #4 / #5 的锁死件）。
 *
 * #4：官方统一模型名 deepseek-flash（版本 DeepSeek-V4.1-Flash）必须命中价目表，
 *     旧名（deepseek-v4.1-flash 等）仍命中（老路由/老数据兜底）；官方条目不带
 *     provider——api-key（deepseek-official）与账号（deepseek-account）两条路由都要能查到。
 * #5：peak/valley 条目 holidays: true 时，中国法定节假日（北京日期）全天按谷价；
 *     数据未就位时退回纯星期口径（宁可旧偏差，不让账单哑火）。
 * 归并：historyKey 写侧 / normalizeMarkKey 读侧把旧模型名与官方双路由并进规范桶
 *     （deepseek/deepseek-flash/…），旧落盘记录免迁移继续参与平均曲线。
 *
 * 运行：node tests/rates-holidays-compat.mjs
 */
import esbuild from 'esbuild'
import { rmSync, writeFileSync } from 'node:fs'

const ENTRY = 'tests/_rates-entry.ts'
const OUT = 'tests/_rates-bundle.mjs'
writeFileSync(ENTRY, "export { _rates } from '../src/index.ts'\n")

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

// 固定时刻（北京时间）：2026-11-03 是周二且不在假期；2026-10-06 是假期中的周二（issue #5 场景）
const TUE_PEAK = new Date('2026-11-03T10:00:00+08:00').getTime()
const TUE_VALLEY = new Date('2026-11-03T20:00:00+08:00').getTime()
const HOLIDAY_PEAK_WINDOW = new Date('2026-10-06T14:43:00+08:00').getTime()

try {
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: OUT,
    logLevel: 'silent',
  })
  const { _rates } = await import('./_rates-bundle.mjs')
  const rateOf = _rates.rateOf

  // ── 注入 2026 年假日数据（离线固定行为；2026-11-03 不在其中）──
  _rates.holidays.inject(2026, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'])

  // ── #4：统一名 deepseek-flash 两条路由都命中 ──
  for (const provider of ['deepseek-official', 'deepseek-account']) {
    const r = rateOf(provider, 'deepseek-flash', TUE_PEAK)
    check(`deepseek-flash @ ${provider} 命中价目表`, r.matched === true, JSON.stringify(r))
    check(`deepseek-flash @ ${provider} 周二上午按峰价 0.04/2/8`, r.tier === 'peak' && r.row.hit === 0.04 && r.row.miss === 2 && r.row.output === 8, JSON.stringify(r.row))
    const v = rateOf(provider, 'deepseek-flash', TUE_VALLEY)
    check(`deepseek-flash @ ${provider} 晚间按谷价 0.02/1/4`, v.tier === 'offPeak' && v.row.hit === 0.02 && v.row.miss === 1 && v.row.output === 4, JSON.stringify(v.row))
  }

  // ── 旧名兜底：旧名照常命中（官方脚注：旧名仍按 Flash 价服务）──
  for (const name of ['deepseek-v4.1-flash', 'deepseek-v4-flash']) {
    const r = rateOf('deepseek-official', name, TUE_PEAK)
    check(`旧名 ${name} 仍命中且峰价一致`, r.matched === true && r.row.hit === 0.04, JSON.stringify(r))
  }
  const acc = rateOf('deepseek-account', 'deepseek-v4.1-flash', TUE_PEAK)
  check('旧名 @ 账号路由也命中（条目已通配双路由）', acc.matched === true, JSON.stringify(acc))

  // ── #5：法定节假日全天谷价 ──
  const hol = rateOf('deepseek-official', 'deepseek-flash', HOLIDAY_PEAK_WINDOW)
  check('假期周二 14:43 按谷价（issue #5 原始场景，修复前误按峰 2 倍）', hol.tier === 'offPeak' && hol.row.hit === 0.02, JSON.stringify(hol))
  const holPro = rateOf('deepseek-official', 'deepseek-v4-pro', HOLIDAY_PEAK_WINDOW)
  check('假期 pro 同样全天谷价', holPro.tier === 'offPeak' && holPro.row.miss === 4.5, JSON.stringify(holPro))
  check('beijingDate 输出北京日期口径', _rates.holidays.beijingDate(HOLIDAY_PEAK_WINDOW) === '2026-10-06', _rates.holidays.beijingDate(HOLIDAY_PEAK_WINDOW))

  // ── 降级：假日数据未就位 → 退回纯星期口径（按峰判），绝不哑火 ──
  _rates.holidays.clear()
  const degraded = rateOf('deepseek-official', 'deepseek-flash', HOLIDAY_PEAK_WINDOW)
  check('假日数据缺失时退回星期口径（此处按峰）', degraded.tier === 'peak' && degraded.row.hit === 0.04, JSON.stringify(degraded))
  // 恢复注入，避免影响后续断言
  _rates.holidays.inject(2026, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'])

  // ── 历史桶归并：写侧 historyKey 与读侧 normalizeMarkKey 同一规范桶 ──
  const canonical = 'deepseek/deepseek-flash/peak'
  check('historyKey 新名双路由同桶', _rates.historyKey('deepseek-official', 'deepseek-flash', 'peak') === canonical && _rates.historyKey('deepseek-account', 'deepseek-flash', 'peak') === canonical)
  check('historyKey 旧名归并进规范桶', _rates.historyKey('deepseek-official', 'deepseek-v4.1-flash', 'peak') === canonical && _rates.historyKey('deepseek-account', 'deepseek-v4-flash', 'peak') === canonical)
  check('pro-0813 版本号别名归并', _rates.historyKey('deepseek-official', 'deepseek-v4-pro-0813', 'offPeak') === 'deepseek/deepseek-v4-pro/valley')
  check('GLM 键不受归并影响', _rates.historyKey('zai-coding-cn', 'glm-5.3', null) === 'zai-coding-cn/glm-5.3/const')
  check('normalizeMarkKey 归并旧落盘 marks（读侧，免迁移）', _rates.normalizeMarkKey('deepseek-official/deepseek-v4.1-flash/peak') === canonical && _rates.normalizeMarkKey('deepseek-account/deepseek-v4-flash/valley') === 'deepseek/deepseek-flash/valley')
  check('normalizeMarkKey 对规范键幂等', _rates.normalizeMarkKey(canonical) === canonical)
  check('normalizeMarkKey 非 3 段串原样透传（防御）', _rates.normalizeMarkKey('weird') === 'weird')

  // ── 预填层形状：通配 deepseek-flash 带 holidays，GLM 不带 ──
  const flash = _rates.PREFILL_RAW['*/deepseek-flash']
  check('预填层含通配 deepseek-flash 条目', flash !== undefined && flash.provider === undefined && flash.holidays === true)
  check('GLM 预填条目原样（provider 限定、无 holidays）', _rates.PREFILL_RAW['zai-coding-cn/glm-5.3']?.provider === 'zai-coding-cn' && _rates.PREFILL_RAW['zai-coding-cn/glm-5.3']?.holidays === undefined)
} catch (error) {
  failed++
  console.log(`  FAIL  测试装挂失败 — ${error instanceof Error ? error.message : error}`)
} finally {
  rmSync(ENTRY, { force: true })
  rmSync(OUT, { force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
