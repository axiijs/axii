/**
 * BUG 6 回归测试：package.json 的 `main` 曾指向根目录不存在的 `index.js`，
 * 老工具链（旧版 Jest / metro / node 解析）解析 `main` 会失败。
 * 正确行为：`main` 必须指向随包发布（`files` 覆盖范围内）的真实构建产物，
 * 与 `exports` 的 require 入口一致。
 */
import {readFileSync} from "fs";
import {fileURLToPath, URL} from "url";
import {describe, expect, test} from "vitest";

describe('BUG 6: package.json entry points', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8'))

    test('main points to the published CJS build artifact, consistent with exports', () => {
        // 多入口 lib 构建（axii + vite-plugin）不支持 umd，CJS 产物是 dist/axii.cjs
        expect(pkg.main).toBe('./dist/axii.cjs')
        expect(pkg.main).toBe(pkg.exports['.'].require)
        // main 必须落在随包发布的 files 范围内
        expect(pkg.files).toContain('dist')
        expect(pkg.main.startsWith('./dist/')).toBe(true)
    })

    test('vite-plugin (node-only code) is a separate subpath export, kept out of the runtime entry', () => {
        expect(pkg.exports['./vite-plugin']).toEqual({
            types: './dist/vite-plugin.d.ts',
            import: './dist/vite-plugin.js',
            require: './dist/vite-plugin.cjs',
        })
    })

    test('data0 is available as a devDependency so a fresh clone can run tests', () => {
        expect(pkg.devDependencies.data0).toBeTruthy()
    })

    // 改进项 15：package.json 曾缺失 sideEffects / repository / description 元数据
    test('package metadata (description / repository / sideEffects) is present', () => {
        expect(pkg.description).toBeTruthy()
        expect(pkg.repository?.url).toContain('github.com/axiijs/axii')
        expect(pkg.sideEffects).toBe(false)
    })
})
