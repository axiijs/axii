/**
 * @internal
 * #55 新激活模型（自顶向下认领）的内部入口。设计：docs/ssr-support/hydration-top-down.md §7。
 *
 * CAUTION 这个模块不从 src/index.ts、ssr.ts 导出，src/ 里也没有别的模块导入它，只有用例导入
 *  （__tests__/helpers/hydrate.ts）。构建时它被 tree-shaking 去掉：公开产物里没有任何代码把激活模式置为「新」，
 *  公开的 hydrateRoot 在 #55 S 之前一直走旧模型（§7.1 第 4 点）。每个实现 PR 的验收都检查 dist 里
 *  找不到本模块独有的字符串。
 */
export function hydrateRootTopDown(
    _container: HTMLElement,
    _source: any,
    _options?: { portals?: Record<string, HTMLElement> },
): never {
    throw new Error('[axii] top-down hydrate entry (internal, #55): not implemented')
}
