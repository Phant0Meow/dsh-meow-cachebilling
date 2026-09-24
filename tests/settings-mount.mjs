/**
 * settings-mount 测试：设置页挂载的双版本契约（0.1.6 settingsScope / 0.1.7 configForms）。
 *
 * settings.ts 只 import react（挂载本身不渲染），用 React 桩 esbuild 打包后直跑：
 * 锁死软取分腿、命名空间传参、scope/scan 注入、configForms 就绪前轮询等待、
 * 双缺安全降级、dispose/计时器清理；末两节展开组件树渲染 BillingCard，
 * 锁死预填快照兜底（0.1.7 上 host base 恒空，价目表必须照常显示）。
 * 运行：node tests/settings-mount.mjs
 */
import { build } from 'esbuild'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const reactStub = `
export function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat() }
}
export function useCallback(fn) { return fn }
export function useState(init) { return [init, () => {}] }
export function useRef(init) { return { current: init } }
export function useEffect() {}
export function cloneElement(el, props) { return { ...el, props: { ...el.props, ...props } } }
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

/** rates.yml 里的模型名清单（断言渲染结果用，与预填快照同源）。 */
function ratesModelNames() {
  const yaml = readFileSync(new URL('../rates.yml', import.meta.url), 'utf8')
  return [...yaml.matchAll(/^\s*-\s*model:\s*(\S+)\s*$/gm)].map((m) => m[1])
}

/** 展开 React 桩树：createElement 只存 type 函数，手动逐层调用展开成纯元素树。 */
function renderTree(component, props, maxDepth = 8) {
  const walk = (node, depth) => {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.flatMap((n) => walk(n, depth))
    if (typeof node.type === 'function') {
      if (depth >= maxDepth) return null
      return walk(node.type(node.props), depth + 1)
    }
    const children = node.children
    return {
      ...node,
      children: Array.isArray(children) ? children.flatMap((c) => walk(c, depth)) : children,
    }
  }
  return walk(component(props), 0)
}

/** 收集渲染树里的全部可见文本（字符串/数字孩子）。 */
function collectText(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  const children = node.children
  if (Array.isArray(children)) for (const child of children) collectText(child, out)
  else if (children !== undefined && children !== null) collectText(children, out)
  return out
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

console.log('=== 5. 预填快照兜底：host base 恒空（0.1.7 dict 根）价目表照常渲染 ===')
{
  const form = {
    subscribe: () => () => {},
    getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, writable: true, revision: 1, mode: 'host' }),
    set: async () => true,
    unset: async () => true,
  }
  const { registrations, slots } = makeSlots()
  const ctx = ctxWithGet({ configForms: { get: () => form } }, slots)
  settings.applySettings(ctx)
  const { options, component } = registrations[registrations.length - 1]
  const lines = collectText(renderTree(component, options.inject()))
  // rates.yml 的每条模型都必须出现在渲染结果里（预填快照兜住空 base）
  const missing = ratesModelNames().filter((m) => !lines.some((t) => String(t).includes(m)))
  check('rates.yml 全部模型名可见', missing.length === 0, `missing=${JSON.stringify(missing)} lines=${JSON.stringify(lines.slice(0, 8))}`)
  check('「添加条目」按钮在场（页面结构完整）', lines.includes('添加条目'))
}

console.log('=== 6. host base 在场：与快照合并（host 条目 + 预填条目同屏）===')
{
  const form = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      status: 'ready',
      value: {},
      base: { 'custom/lake': { model: 'lake-model', provider: 'custom' } },
      user: {},
      writable: true,
      revision: 1,
      mode: 'user',
    }),
    set: async () => true,
    unset: async () => true,
  }
  const { registrations, slots } = makeSlots()
  const ctx = ctxWithGet({ configForms: { get: () => form } }, slots)
  settings.applySettings(ctx)
  const { options, component } = registrations[registrations.length - 1]
  const lines = collectText(renderTree(component, options.inject()))
  check('host base 条目可见', lines.some((t) => String(t).includes('lake-model')), JSON.stringify(lines.slice(0, 8)))
  const missing = ratesModelNames().filter((m) => !lines.some((t) => String(t).includes(m)))
  check('预填快照条目仍可见（合并而非替换）', missing.length === 0, `missing=${JSON.stringify(missing)}`)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
