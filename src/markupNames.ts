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
// correct namespace immediately. Tags that exist in both HTML and SVG (svgHtmlSharedElementNames)
// are created on the HTML path and moved into the SVG namespace by their SVG parent (#56).
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

/**
 * @internal
 * HTML 与 SVG 里都有的元素名（#56）。命名空间由父元素决定，与 HTML 解析器在外来内容（foreign content）里的规则相同：
 *  父元素是 SVG 元素、且不是 HTML integration point（isSvgHtmlIntegrationPoint）时是 SVG 元素，否则是 HTML 元素。
 * CAUTION 服务端写出的 <svg><title>…</title></svg> 解析后一定是 SVG 的 title，客户端只看标签名的话建出来的是 HTML 元素：
 *  CSR 里 <title> 不是图形的提示、<a> 里的图形整个不渲染；激活时每个都报告失配并重建。客户端 JSX 先求值子节点，
 *  子元素创建时不知道父元素，所以由 SVG 父元素在 createElement 里把这些子元素改建到 SVG 命名空间（DOM.adoptSvgChildren），
 *  激活时在父元素的游标下按 SVG 认领（DOM.materializeHydrateDeferred），服务端按 SVG 的规则写属性（ssr.serializeSsrElement）。
 *  三处都只用这一张表。
 */
export const svgHtmlSharedElementNames = new Set(['a', 'script', 'style', 'title'])

/**
 * @internal
 * SVG 里的 HTML integration point：子内容回到 HTML（解析器 tree construction 的规则）。
 *  接受 JSX 标签名（foreignObject）与小写形式（服务端按小写比较），不分配字符串。
 */
export function isSvgHtmlIntegrationPoint(name: string): boolean {
    return name === 'foreignObject' || name === 'foreignobject' || name === 'desc' || name === 'title'
}

// CAUTION 这两类元素的子内容是字符数据，注释语法在里面不产生 Comment（§3.2.1 F11）：
//  SSR 不能在其中写 axii:* 标记，多个文本单元只能首尾相接成一段；激活时按同一张表反过来拆。
//  noscript 一律按 RAWTEXT（保守归类，见 §3.2.1 父节点分类）。
export const RCDATA_TAGS = new Set(['textarea', 'title'])

/**
 * @internal
 * table 的分区元素（小写名）。服务端决定要不要为 table 的内容补 <tbody>（ssr.serializeTableContent）、
 * 激活时判定隐含 tbody（hydration.impliedTableBody）用同一张表。
 */
export const tableSectionElementNames = new Set(['tbody', 'thead', 'tfoot', 'caption', 'colgroup'])
export const RAWTEXT_TAGS = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'])

// ARIA 反射属性（ariaLabel / ariaExpanded ...）：第 5 个字符是大写字母。
//  对应的 attribute 是 aria- 加上其余部分的小写（ariaValueNow -> aria-valuenow）。
export function isAriaReflectionProperty(name: string): boolean {
    if (name.length < 5 || name[0] !== 'a' || name[1] !== 'r' || name[2] !== 'i' || name[3] !== 'a') return false
    const fifth = name.charCodeAt(4)
    return fifth >= 65 && fifth <= 90
}

/**
 * @internal
 * 事件名：on + 大写字母（onClick / onChangeCapture）。事件名的唯一判定，DOM.ts / ComponentHost /
 * StaticHost / diagnostics 都用这一份（DOM.ts 原样导出它，公开 API 不变）。
 * CAUTION 宽松的 startsWith('on') 会把 once/online 这类普通 prop 吞进事件分支——
 *  挂上一个永不触发的假监听器；与 mergeProp 的约定一致，只认 on + 大写字母。
 *  放在本模块而不是 DOM.ts：axii/ssr 与 diagnostics 都要用它，而它们不能 import DOM.ts。
 */
export function isEventName(name: string): boolean {
    if (name[0] !== 'o' || name[1] !== 'n') return false
    const third = name.charCodeAt(2)
    return third >= 65 && third <= 90
}

/**
 * @internal
 * 名字以 on 开头（不区分大小写）且长于 2：可能被浏览器当成事件处理器 content attribute 的那一类名字。
 * CAUTION HTML 的属性名大小写不敏感（解析和 setAttribute 都会转小写），ONCLICK / oNclick 写出去就是
 *  可执行的 onclick；SVG 和自定义元素上的 onclick 同样是事件处理器。所以这类名字只有
 *  「isEventName 且值是函数 / 函数数组」时才是事件（客户端 addEventListener），其余一律两端都不写——
 *  既不写 attribute 也不写 property，也不建立响应式属性绑定（#49，规则与 React 的 shouldIgnoreAttribute 相同）。
 *  不区分元素类型：SVG、自定义元素上的 onclick attribute 同样可执行，一并丢弃。
 *  单独的 on 不是任何事件属性（AMP 的 on="tap:…" 是合法属性），与 React 一样照常写出。
 *  热路径约束：DOM.setAttribute 用它替换原来的 isEventName 分发判断，名字首字符不是 o/O 时
 *  只读一次 charCode，和原来的首字符比较等价，普通属性写入不多付任何代价。
 */
export function hasOnPrefix(name: string): boolean {
    return (name.charCodeAt(0) | 32) === 111 && (name.charCodeAt(1) | 32) === 110 && name.length > 2
}

/**
 * @internal
 * dangerouslySetInnerHTML 的 React 形状 {__html}：带 __html 键的对象（#50）。两端共用这一份判定：
 *  DOM.setAttribute 解包、createElement.isValidAttribute 把它当静态值（激活时走「已认领元素不重写
 *  innerHTML」的路径，服务端节点原样保留）、激活时「内容是原始标记」的判定、axii/ssr 的输出。
 * CAUTION 只认带 __html 键的对象，其余对象原样透传：TrustedHTML（Trusted Types 下 innerHTML 的合法值）
 *  没有 __html，按「是对象就取 .__html」会被解包成 undefined、静默清空内容。数组不带 __html，
 *  仍按 setAttribute 的「数组取最后一项」处理（mergeProp 合并出的覆盖值）。
 */
export function isInnerHTMLObject(value: any): value is {__html: unknown} {
    return value !== null && typeof value === 'object' && '__html' in value
}

/**
 * @internal
 * dangerouslySetInnerHTML 值实际表示的 HTML：{__html} 取出 __html，其余原样（字符串、nullish、TrustedHTML…）。
 *  结果为 nullish 表示清空：{__html: null} / {__html: undefined} 与 null / undefined 同义。
 */
export function innerHTMLOf(value: any): any {
    return isInnerHTMLObject(value) ? value.__html : value
}

// ─── property 分支的写法（#51）：CSR 的 DOM.setAttribute 与 axii/ssr 共用这一份 ───
//  客户端对 HTML 元素上「是 property 的名字」做 property 赋值，浏览器按 IDL 类型转换、再反射成 attribute；
//  服务端没有 DOM，只能按同一条写入规则 + 下面的静态类型表推出同一个 attribute。规则、别名、类型知识都只在这里定义：
//  曾经 ssr.ts 自己有一张 string 型 property 表（不看元素）和一张别名表，DOM.ts 另有一张别名表——
//  required / readOnly / open 两端写出 "" 与 "true"，tabIndex={true} 写出 "1" 与 "true"，<div href> 写出 "true" 与 ""，
//  <input defaultValue> 在服务端变成不认识的 defaultvalue（#51）。

/**
 * property 名与 content attribute 名不同（转小写之后也不同）的情况。客户端按它移除 attribute
 * （removeAttribute('htmlFor') / removeAttribute('ch') 是空操作，for / char 会永远留在元素上），
 * 服务端按它写出 attribute 名——只对该元素上确实是 property 的名字生效（见 htmlPropertyTypes.htmlPropertyType）：
 * <div htmlFor="x"> 在客户端走 attribute 分支，写出的就是 htmlfor。
 * classList / relList / output.htmlFor 是 DOMTokenList（[PutForwards=value]）。
 */
export const propertyAttributeAliases: {[property: string]: string} = /* @__PURE__ */ Object.assign(Object.create(null), {
    htmlFor: 'for',
    httpEquiv: 'http-equiv',
    acceptCharset: 'accept-charset',
    encoding: 'enctype',
    defaultValue: 'value',
    defaultChecked: 'checked',
    defaultSelected: 'selected',
    defaultMuted: 'muted',
    classList: 'class',
    relList: 'rel',
    ch: 'char',
    chOff: 'charoff',
})

/** @internal property 对应的 content attribute 名（别名、ARIA 反射属性，其余同名）。 */
export function attributeNameOfProperty(name: string): string {
    const alias = propertyAttributeAliases[name]
    if (alias !== undefined) return alias
    // ariaLabel -> aria-label，ariaValueNow -> aria-valuenow
    return isAriaReflectionProperty(name) ? `aria-${name.slice(4).toLowerCase()}` : name
}

/**
 * @internal
 * boolean / undefined 原样赋给 property 的名字（不按 property 类型改写，见 emptyOrBooleanWrite）：
 *  - contentEditable / writingSuggestions / aria*：取值是 "true"/"false" 关键字的 string property，false 是有语义的值；
 *  - hidden：它的 getter 在 until-found 状态下返回字符串，类型不能代表写法。
 *  自定义元素（标签名带 '-'）上的所有名字同样原样赋值：property 的语义由组件自己定义——由调用方判断。
 */
export function isRawWriteProperty(name: string): boolean {
    return name === 'contentEditable' || name === 'writingSuggestions' || name === 'hidden' || isAriaReflectionProperty(name)
}

// emptyOrBooleanWrite 的写入码：低两位是写进 property 的值，REMOVE_ATTRIBUTE 表示随后按真实 attribute 名移除。
/** @internal 原样写入 value */
export const WRITE_VALUE = 0
/** @internal 写入 '' */
export const WRITE_EMPTY = 1
/** @internal 写入 null */
export const WRITE_NULL = 2
/** @internal 写完后移除 attribute（attributeNameOfProperty） */
export const REMOVE_ATTRIBUTE = 4

/**
 * @internal
 * property 分支里 undefined / boolean 值的写入规则（唯一一份；null 不读类型，见 DOM.setEmptyOrBooleanProperty）。
 * current 是 property 的当前值：客户端读 node[name]（只在这个慢路径里读一次），服务端用静态类型的样本值；
 * 原样赋值的情况（isRawWriteProperty、自定义元素）传 undefined。
 *
 * CAUTION property 赋值按 IDL 类型做转换，原样赋值只对「boolean 值 → boolean property」是对的：
 *  - string property 会把 false/undefined 字符串化：title={cond && 'tip'} 渲染出 title="false"，
 *    href={false} 链接到 /false，download={false} 反而变成下载链接，htmlFor={undefined} 关联到 id 为 "undefined" 的控件；
 *  - number property 把 false 变成 0：maxLength={false} 的输入框一个字符都输不进去；
 *  - object 类型的可空 property（srcObject 的 MediaStream、valueAsDate 的 Date）不接受 ''，它们的「空」是 null；
 *    当前值为 null 的可空反射属性（未设置的 popover / crossOrigin / role）写 null 同样等于移除 attribute；
 *    DOMTokenList（sandbox / relList，[PutForwards=value]）写 null 会先写出 "null"，随后按 attribute 名移除。
 *
 *  | 值        | property 类型（current）                  | 写入                                    |
 *  |-----------|-------------------------------------------|-----------------------------------------|
 *  | undefined | string                                    | ''，移除 attribute                       |
 *  | undefined | object（current 为 null 或对象）          | null，移除 attribute                     |
 *  | undefined | 其他                                      | 原样（undefined），移除 attribute         |
 *  | false     | string / number                           | ''，移除：「条件不满足」= 没写这个属性     |
 *  | false     | object                                    | null，移除 attribute                     |
 *  | false     | 其他（boolean）                           | 原样                                     |
 *  | true      | string，或 current 为 null 的可空反射属性 | ''（等价于 HTML 里只写属性名：download / popover / alt）|
 *  | true      | 其他                                      | 原样（number property 得到 1）            |
 */
export function emptyOrBooleanWrite(current: unknown, value: undefined | boolean): number {
    const type = typeof current
    if (type === 'string') return value === true ? WRITE_EMPTY : WRITE_EMPTY | REMOVE_ATTRIBUTE
    if (type === 'object') {
        if (value !== true) return WRITE_NULL | REMOVE_ATTRIBUTE
        return current === null ? WRITE_EMPTY : WRITE_VALUE
    }
    if (type === 'number' && value === false) return WRITE_EMPTY | REMOVE_ATTRIBUTE
    return value === undefined ? WRITE_VALUE | REMOVE_ATTRIBUTE : WRITE_VALUE
}

/**
 * @internal
 * textarea 的内容由哪个 prop 决定：value（§3.6.2 TA 通道）优先，其次 defaultValue（客户端的赋值替换子文本）；
 * 都没有时内容来自 children。服务端把它写成子文本，激活时这段子文本是它的编码、不是哪个 child 单元的节点（DOM.createElement）。
 */
export function textareaContentProp(props: {[key: string]: unknown} | null | undefined): 'value' | 'defaultValue' | undefined {
    if (!props) return undefined
    if (Object.prototype.hasOwnProperty.call(props, 'value')) return 'value'
    if (Object.prototype.hasOwnProperty.call(props, 'defaultValue')) return 'defaultValue'
    return undefined
}
