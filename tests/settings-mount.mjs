/**
 * settings-mount 测试：设置页挂载的双版本契约（0.1.6 settingsScope / 0.1.7 configForms）。
 *
 * settings.ts 只 import react（挂载本身不渲染），用 React 桩 esbuild 打包后直跑：
 * 锁死软取分腿、命名空间传参、scope/scan 注入、configForms 就绪前轮询等待、
 * 双缺安全降级、dispose/计时器清理。运行：node tests/settings-mount.mjs
 */
import { build } from 'esbuild'
import { rmSync, writeFileSync } from 'node:fs'

const reactStub = `
export function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat() }
}
export function useCallback(fn) { return fn }
export function useState(init) { return [init, () => {}] }
export function useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot() }
export const __stub = true
`

const ENTRY = 'tests/_settings-mount-entry.ts'
writeFileSync(
  ENTRY,
  "export { applySettings } from '../src/settings.ts'\n",
  'utf8',
)

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
const settings = await import(modUrl)

// ── DOM 桩：CSS 覆盖式注入需要 document；scan 不在本测试范围（不触发即不碰 window）──
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: () => {} },
}

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ok  ${name}`)
  } else {
    failed++
    console.log(`FAIL  ${name} ${detail}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** slots 服务桩：记录每次 register 的 {options, component}，inject 同步回调（真实外壳语义）。 */
function makeSlots() {
  const registrations = []
  return {
    registrations,
    slots: {
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
      inject: (_slot, cb) => {
        cb()
        return () => {}
      },
    },
  }
}

/** ctx.get 形态的宿主桩（真实宿主两版都有 ctx.get；返回 undefined=服务缺席）。 */
function ctxWithGet(services, slots) {
  return { get: (name) => services[name], slots }
}

/** configForms.get 产出的共享表单桩：0.1.7 ConfigForm 的形状（含 mode/revision）。 */
function makeFormStub() {
  return {
    subscribe: () => () => {},
    getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, writable: true, revision: 3, mode: 'host' }),
    set: async () => true,
    unset: async () => true,
  }
}

console.log('=== 1. 0.1.6 腿（settingsScope.bind 原链路）===')
{
  const bound = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, writable: true, mode: 'user' }), set: async () => {}, unset: async () => {} }
  const bindArgs = []
  const { registrations, slots } = makeSlots()
  const ctx = ctxWithGet({ settingsScope: { bind: (args) => { bindArgs.push(args); return bound } } }, slots)
  settings.applySettings(ctx)
  check('注册了 settings.section', registrations.length >= 1 && registrations[registrations.length - 1].options.name === 'settings.section')
  check('绑定 meow-cachebilling 命名空间', bindArgs.some((a) => a.namespace === 'meow-cachebilling'), JSON.stringify(bindArgs))
  const injected = registrations[registrations.length - 1].options.inject()
  check('scope=bind 结果', injected.scope === bound)
  check('scan 注入在场（模型目录扫描）', typeof injected.scan === 'function')
  check('order=30', registrations[registrations.length - 1].options.order === 30)
}

console.log('=== 2. 0.1.7 腿（configForms 就绪：表单直接当 scope）===')
{
  const form = makeFormStub()
  const getCalls = []
  const { registrations, slots } = makeSlots()
  const ctx = ctxWithGet({ configForms: { get: (id) => { getCalls.push(id); return form } } }, slots)
  settings.applySettings(ctx)
  check('注册了 settings.section', registrations.length >= 1 && registrations[registrations.length - 1].options.name === 'settings.section')
  check('以命名空间取表单', getCalls.includes('meow-cachebilling'), JSON.stringify(getCalls))
  const injected = registrations[registrations.length - 1].options.inject()
  check('scope=configForms 表单', injected.scope === form)
  check('scan 注入在场', typeof injected.scan === 'function')
}

console.log('=== 3. 双缺（异常宿主）：不注册、轮询自行放弃 ===')
{
  const { registrations, slots } = makeSlots()
  const ctx = ctxWithGet({}, slots)
  settings.applySettings(ctx, { pollMs: 5, maxPollAttempts: 2 })
  check('双缺不注册设置页', registrations.length === 0, String(registrations.length))
  await sleep(40)
  check('轮询放弃后仍不注册', registrations.length === 0, String(registrations.length))
}

console.log('=== 4. 0.1.7 腿（configForms 迟到）：轮询等到即挂页 ===')
{
  const form = makeFormStub()
  let calls = 0
  const { registrations, slots } = makeSlots()
  const ctx = ctxWithGet({ get configForms() { calls += 1; return calls > 3 ? { get: () => form } : undefined } }, slots)
  settings.applySettings(ctx, { pollMs: 5, maxPollAttempts: 200 })
  check('configForms 缺席期间不注册', registrations.length === 0, String(registrations.length))
  await sleep(60)
  check('configForms 就绪后轮询挂页', registrations.length >= 1 && registrations[registrations.length - 1].options.inject().scope === form, String(registrations.length))
  await sleep(20)
  check('挂页后轮询停止（不重复注册）', registrations.length === 1, String(registrations.length))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
