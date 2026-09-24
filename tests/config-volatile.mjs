/**
 * Config volatile 标记契约测试（2026-09-24「设置页仅本机回环可编辑」排查的锁死件）。
 *
 * dsh 0.1.7 设置服务 describe() 只收录 volatileForm(Config) 非空的插件——即 Config
 * 根上必须带 meta.volatile，否则整个插件不进命名空间名单（dict 类型进不了
 * volatileForm 的 object 递归，必须根标），设置页永远显示「当前连接不支持设置写入
 * （仅本机回环连接可编辑）」（文案误导，与连接无关）。
 *
 * 同时锁死运行时安全假设：仓内 schemastery@3.18.1 的解析不含 volatile 逻辑，
 * meta 只是宿主侧标记——~standard.validate 必须返回裸值（官方新版 .volatile()
 * 会把值包成 createVolatile 的 .get() 引用，消费端就得逐处改读法）。
 * 若日后升级 schemastery 使本测试第 2 组断言失败，须重验全部 config 消费点。
 *
 * 运行：node tests/config-volatile.mjs
 */
import esbuild from 'esbuild'
import { rmSync, writeFileSync } from 'node:fs'

const ENTRY = 'tests/_config-volatile-entry.ts'
const OUT = 'tests/_config-volatile-bundle.mjs'
writeFileSync(ENTRY, "export { Config } from '../src/index.ts'\n")

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

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
  const { Config } = await import('./_config-volatile-bundle.mjs')

  check('Config 根带 meta.volatile（0.1.7 describe 收录的必要条件；dict 只能根标）', Config?.meta?.volatile === true)
  check('Config 仍是 dict 形状', Config?.type === 'dict', `type=${Config?.type}`)

  const probe = { 'deepseek-official/glm-5.3-flash': { hit: 0.5, miss: 2, output: 8 } }
  const result = Config['~standard'].validate(probe)
  const value = result.value
  check('~standard.validate 无 issues', !result.issues)
  check('解析值是裸值非 Volatile 包装（根对象无 get 协议）', typeof value?.get !== 'function')
  check('键集开放照常透传（deepseek-official/glm-5.3-flash 原样保留）', value?.['deepseek-official/glm-5.3-flash']?.hit === 0.5)
} catch (error) {
  failed++
  console.log(`  FAIL  测试装挂失败 — ${error instanceof Error ? error.message : error}`)
} finally {
  rmSync(ENTRY, { force: true })
  rmSync(OUT, { force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
