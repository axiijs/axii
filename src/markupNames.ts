/**
 * 与 DOM 无关的 HTML / SVG 名称表。CSR（DOM.ts / hydration.ts）与 axii/ssr 共用这一份——
 * 同一张表存在两份的话，哪天只改了一边，SSR 输出就会和 CSR 的 DOM 悄悄分叉。
 * CAUTION 这里不能访问 document / window：axii/ssr 在纯 Node 环境加载本模块。
 */

// CAUTION SVG 的 presentation attribute（可以当 attribute 写的 CSS 属性）在 DOM 里是连字符名
//  （stroke-width / fill-rule / stop-color），JSX 里按 React 习惯写驼峰（strokeWidth）。
//  SVG 没有「驼峰 ⇔ 连字符」的通用规则：viewBox、gradientUnits、clipPathUnits、markerWidth
//  这些原生 attribute 本身就是驼峰且大小写敏感，一律转换会把它们全部写坏——所以只能按清单转换。
//  清单取 SVG 2 §6.6 "Presentation attributes" 与 SVG 1.1 property index 的并集里所有带连字符
//  的名字（单词名 fill/stroke/opacity 不需要转换），按完整名字匹配。
//  之前只列了 9 个（stroke* 的一部分 + fillOpacity/stopOpacity）：SVG 转 JSX 的图标里最常见的
//  fillRule/clipRule 被原样写成 attribute "fillRule"，浏览器不认，镂空图标静默渲染成实心；
//  同一个 <stop> 上 stopOpacity 生效而 stopColor 不生效。
//  这张表放在本模块而不是 DOM.ts：axii/ssr 写属性名时用的必须是同一张表（服务端原样写出
//  fillRule 的话解析后是不认识的 fillrule），而 SSR 入口不直接 import DOM.ts。
export const svgPresentationAttributeNames: {[camelCaseName: string]: string} = /* @__PURE__ */ (() => {
    const names: {[camelCaseName: string]: string} = Object.create(null)
    const attributes = 'alignment-baseline baseline-shift clip-path clip-rule color-interpolation ' +
        'color-interpolation-filters color-profile color-rendering dominant-baseline enable-background ' +
        'fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust ' +
        'font-stretch font-style font-variant font-weight glyph-orientation-horizontal ' +
        'glyph-orientation-vertical image-rendering letter-spacing lighting-color marker-end marker-mid ' +
        'marker-start mask-type paint-order pointer-events shape-rendering stop-color stop-opacity ' +
        'stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit ' +
        'stroke-opacity stroke-width text-anchor text-decoration text-overflow text-rendering ' +
        'transform-box transform-origin unicode-bidi vector-effect white-space word-spacing writing-mode'
    for (const attribute of attributes.split(' ')) {
        names[attribute.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())] = attribute
    }
    return names
})()

/** SVG 元素上的 prop 名对应的 attribute 名（xlink 前缀由调用方单独处理）。 */
export function svgAttributeName(name: string): string {
    return svgPresentationAttributeNames[name] ?? name
}

// JSX evaluates children before their parent, so the runtime cannot infer an SVG namespace
// from ancestry the way a VDOM renderer can. Create tags that only exist in SVG in the
// correct namespace immediately. Ambiguous HTML/SVG tags (a/script/style/title) deliberately
// stay on the HTML path; inside SVG they should use the explicit createSVGElement factory.
// CAUTION 这个判断必须在 createElement 内部做（而不是只在 jsx/jsxs/jsxDEV runtime 路由）：
//  classic pragma（/* @jsx createElement */）和组件 renderContext 的 createElement 都不经过
//  runtime factory，只在 runtime 路由的话这两条链路里 <svg> 会被创建成 HTMLUnknownElement，
//  整个图形静默不显示——同一个 JSX 在两种编译模式下行为分叉。
export const svgOnlyElementNames = new Set([
    'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath', 'defs', 'desc',
    'ellipse', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
    'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
    'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
    'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
    'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
    'filter', 'foreignObject', 'g', 'image', 'line', 'linearGradient', 'marker', 'mask',
    'metadata', 'mpath', 'path', 'pattern', 'polygon', 'polyline', 'radialGradient',
    'rect', 'set', 'stop', 'svg', 'switch', 'symbol', 'text', 'textPath', 'tspan',
    'use', 'view',
])

// CAUTION 这两类元素的子内容是字符数据，注释语法在里面不产生 Comment（§3.2.1 F11）：
//  SSR 不能在其中写 axii:* 标记，多个文本单元只能首尾相接成一段；激活时按同一张表反过来拆。
//  noscript 一律按 RAWTEXT（保守归类，见 §3.2.1 父节点分类）。
export const RCDATA_TAGS = new Set(['textarea', 'title'])
export const RAWTEXT_TAGS = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'])

// ARIA 反射属性（ariaLabel / ariaExpanded ...）：第 5 个字符是大写字母。
//  对应的 attribute 是 aria- 加上其余部分的小写（ariaValueNow -> aria-valuenow）。
export function isAriaReflectionProperty(name: string): boolean {
    if (name.length < 5 || name[0] !== 'a' || name[1] !== 'r' || name[2] !== 'i' || name[3] !== 'a') return false
    const fifth = name.charCodeAt(4)
    return fifth >= 65 && fifth <= 90
}
