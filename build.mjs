/**
 * Build script: TS source -> deployable package.
 *
 * Two artifacts:
 *  - lib/index.js — host loader entry (exports["."] / main), loaded by the
 *    dsh Node process (zod bundled in; the projection registry only calls
 *    schema.parse duck-typed, no instanceof checks, so bundling is safe).
 *  - lib/client.js — browser bundle in ModuleLoader.load format; react stays
 *    external (shell singleton, ModuleLoader resolves it).
 *
 * Prerequisites: `npm install` (brings esbuild + zod into ./node_modules).
 */
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';

const watch = process.argv.includes('--watch');

const nodePaths = [fileURLToPath(new URL('./node_modules', import.meta.url))];

const hostOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  nodePaths,
  outfile: 'lib/index.js',
  sourcemap: true,
  logLevel: 'info',
  // 保留 UTF-8 源码字符（默认 ascii 会把中文注释/字符串转成 \uXXXX，产物难读）
  charset: 'utf8',
};

const clientOptions = {
  entryPoints: ['src/client.ts'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  nodePaths,
  outfile: 'lib/client.js',
  // react 走 shell 单例（ModuleLoader 的 require 解析到 seed 里的 react），
  // 不能打进 bundle——否则双 React 实例会崩掉 slots 渲染。
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  // 同上：中文文案（账单标题等）保持 UTF-8 原样输出，不转义
  charset: 'utf8',
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      '  id: "dsh-cache-billing",',
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: ['    return module.exports;', '  }', '});'].join('\n'),
  },
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  await (await context(hostOptions)).watch();
  await (await context(clientOptions)).watch();
  console.log('[build] watching src/ for changes...');
} else {
  await Promise.all([build(hostOptions), build(clientOptions)]);
}
