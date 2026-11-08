/**
 * 时区校验测试(issue #6:自定义 API 价目时区填了非 IANA 格式,保存不拦、运行时静默丢弃)。
 *
 * 锁死第一层修复:保存时 validateDraft 用 isIanaZone(与运行时 compileEntry 同一裁决者
 * Intl.DateTimeFormat)提前拦截非法时区,错误文案必须含「IANA」并给出示例;
 * 空值语义维持原样(非内置 provider 必填,内置 provider 由表带出)。
 *
 * settings.ts 只 import react,用 settings-mount 同款 React 桩 esbuild 打包后直跑。
 * 运行:node tests/tz-validate.mjs
 */
import { build } from 'esbuild'
import { rmSync, writeFileSync } from 'node:fs'

const reactStub = `
export function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat() }
}
export const __stub = true
`

const ENTRY = 'tests/_tz-validate-entry.ts'
writeFileSync(ENTRY, "export { validateDraft } from '../src/settings.ts'\n")

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** validateDraft 的最小峰谷 Draft:价格/时段全部合法,只动时区字段。 */
const PEAK_BASE = {
  model: 'deepseek-chat',
  provider: '',
  isPeak: true,
  whenText: '[mon-fri][09:00-12:00]',
  timezone: '',
  peakHit: '1', peakMiss: '1', peakOutput: '1',
  valleyHit: '1', valleyMiss: '1', valleyOutput: '1',
  flatHit: '', flatMiss: '', flatOutput: '',
  holidays: false,
  cacheSaving: '',
}
const draft = (over = {}) => ({ ...PEAK_BASE, ...over })

let modUrl
try {
  const { outputFiles } = await build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'react-stub',
        setup(b) {
          b.onResolve({ filter: /^react$/ }, () => ({ path: 'react-stub', namespace: 'stub' }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: reactStub, loader: 'js' }))
        },
      },
    ],
  })
  modUrl = 'data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64')
} finally {
  rmSync(ENTRY, { force: true })
}

try {
  const { validateDraft } = await import(modUrl)

  // 合法 IANA 名放行
  check('Asia/Shanghai 通过', validateDraft(draft({ timezone: 'Asia/Shanghai' })) === null)
  check('America/New_York 通过', validateDraft(draft({ timezone: 'America/New_York' })) === null)
  check('UTC 通过(openrouter/openai 等账单方在 UTC)', validateDraft(draft({ timezone: 'UTC' })) === null)

  // 非法写法拦下,文案含 IANA(让用户从报错里学会正确格式)
  for (const bad of ['UTC+8', 'GMT+8', '中国时间']) {
    const err = validateDraft(draft({ timezone: bad }))
    check(`非法时区「${bad}」被拦,文案含 IANA 示例`, typeof err === 'string' && err.includes('IANA'), err ?? '未报错')
  }

  // 空值语义不变:非内置 provider 必填;内置 provider 由表带出
  check('空时区 + 非内置 provider → 提示不能为空', (validateDraft(draft({ timezone: ' ', provider: 'my-relay' })) ?? '').includes('不能为空'))
  check('空时区 + 内置 provider(deepseek-official)→ 由表带出,通过', validateDraft(draft({ timezone: '', provider: 'deepseek-official' })) === null)

  // 一口价条目不涉时区
  check('一口价条目不校验时区', validateDraft({ ...PEAK_BASE, isPeak: false, flatHit: '1', flatMiss: '1', flatOutput: '1' }) === null)
} catch (error) {
  failed++
  console.log(`  FAIL  测试装挂失败 — ${error instanceof Error ? error.message : error}`)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)