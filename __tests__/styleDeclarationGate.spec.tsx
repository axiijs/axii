/** @jsx createElement */
/**
 * #78：样式声明门闩按浏览器的 CSS 词法判断。
 *
 * stylesheet 规则（insertRule）和 renderToString（<style> 里的规则、style 属性）都把声明拼成文本，
 * 再交给浏览器的 CSS tokenizer 重新切分。门闩（isAcceptableInlineDeclaration）只要和浏览器的分界
 * 不同，一个值拼进去之后就会变成多条声明，或者变成一条嵌套规则；CSR 的行内样式经 CSSOM 赋值，
 * 同一个值整条被拒绝。SSR 的规则门闩（isAcceptableSingleCssRule）用同一套词法。
 *
 * Oracles:
 *  (a) 敌意值：stylesheet 路径与 SSR 的任何规则都不声明 position、没有嵌套规则，
 *      元素的 computed 与 CSR 行内一致（CSR 行内拒绝这些值）；
 *  (b) 合法的复杂值：CSR 行内确实生效，stylesheet 路径与 SSR 的 computed 与它一致；
 *  (c) 差分模糊（单向）：门闩放行的值，在规则文本、整张样式表、style 属性里解析出的声明与
 *      CSSOM setProperty 的结果逐字相同。门闩比浏览器严格可以，放行了就必须一致。
 */
import {createElement, createRoot, RenderContext} from '@framework'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {isAcceptableSingleCssRule, renderToString} from '../src/ssr.js'
import {cssPropertyName, isAcceptableInlineDeclaration} from '../src/styleSerialize.js'

let root: ReturnType<typeof createRoot>
let rootEl: HTMLElement
beforeEach(() => {
    document.body.innerHTML = ''
    rootEl = document.createElement('div')
    document.body.appendChild(rootEl)
    root = createRoot(rootEl)
})
afterEach(() => {
    root.destroy()
})

const HOVER = {'&:hover': {outlineColor: 'rgb(255, 0, 0)'}}

// 同一组声明：一份纯行内（CSR 经 CSSOM），一份带嵌套 key（走 stylesheet）
function Pair({declarations}: any, {createElement}: RenderContext) {
    return <div>
        <div id="inline" style={declarations}>x</div>
        <div id="sheet" style={{...declarations, ...HOVER}}>x</div>
    </div>
}

function computedOf(el: Element, declarations: Record<string, any>): Record<string, string> {
    const computed = getComputedStyle(el)
    const out: Record<string, string> = {}
    for (let i = 0; i < computed.length; i++) out[computed[i]] = computed.getPropertyValue(computed[i])
    for (const key in declarations) if (key.startsWith('--')) out[key] = computed.getPropertyValue(key)
    return out
}

function diff(expected: Record<string, string>, actual: Record<string, string>): string[] {
    const diffs: string[] = []
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
        if (expected[key] !== actual[key]) diffs.push(`${key}: ${expected[key]} → ${actual[key]}`)
    }
    return diffs
}

// 注入的形态，返回这些规则的文本：声明了 position、style 规则下面长出了嵌套规则、
//  或者 selector 里没有这个元素自己的 class（一条值拼出了别的全局规则，例如 body {…}）
function injectedRules(sheets: Iterable<CSSStyleSheet>, owner: Element): string[] {
    const found: string[] = []
    const classes = Array.from(owner.classList).map(name => `.${name}`)
    const walk = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule && (rule.style.getPropertyValue('position') || rule.cssRules.length
                || !classes.some(name => rule.selectorText.includes(name)))) {
                found.push(rule.cssText)
            }
            if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules)
        }
    }
    for (const sheet of sheets) walk(sheet.cssRules)
    return found
}

// CSR 与 SSR 生成相同的 class 名，两边的样式会互相作用：先单独量 SSR，移除后再量 CSR
function measure(declarations: Record<string, any>) {
    const {html, styles} = renderToString(createElement(Pair, {declarations}))
    const ssrEl = document.createElement('div')
    ssrEl.innerHTML = `<style>${styles}</style>${html}`
    document.body.appendChild(ssrEl)
    const ssr = {
        inline: computedOf(ssrEl.querySelector('#inline')!, declarations),
        sheet: computedOf(ssrEl.querySelector('#sheet')!, declarations),
        injected: injectedRules([ssrEl.querySelector('style')!.sheet!], ssrEl.querySelector('#sheet')!),
    }
    ssrEl.remove()

    root.render(<Pair declarations={declarations}/>)
    const inlineEl = rootEl.querySelector('#inline') as HTMLElement
    const csr = {
        inline: computedOf(inlineEl, declarations),
        sheet: computedOf(rootEl.querySelector('#sheet')!, declarations),
        injected: injectedRules(document.adoptedStyleSheets, rootEl.querySelector('#sheet')!),
    }
    return {ssr, csr, inlineStyle: inlineEl.style}
}

describe('#78 hostile values add no declaration or rule (stylesheet path and SSR ≡ CSR inline)', () => {
    const corpus: [string, Record<string, string>][] = [
        // 不带引号的 url：浏览器得到 bad-url，在第一个 ")" 处结束，后面的 ";" 落在顶层
        ['unquoted url with "(" (issue)', {backgroundImage: 'url(a(b);position:fixed;x:())'}],
        ['upper-case URL(', {backgroundImage: 'URL(a(b);position:fixed;x:())'}],
        ['unquoted url with whitespace', {backgroundImage: 'url(a b(c);position:fixed;x:())'}],
        ['unquoted url with a double quote', {backgroundImage: 'url(a"b);position:fixed;x:("c)'}],
        ['unquoted url with a single quote', {backgroundImage: "url(a'b);position:fixed;x:('c)"}],
        ['unquoted url with "\\" + newline', {backgroundImage: 'url(a\\\n(b);position:fixed;x:())'}],
        // 函数名按转义解码后比较：这些都是 url(
        ['escaped "u": \\75rl(', {backgroundImage: '\\75rl(a(b);position:fixed;x:())'}],
        ['hex escape eats one whitespace: u\\72 l(', {backgroundImage: 'u\\72 l(a(b);position:fixed;x:())'}],
        ['hex escape eats CRLF as one whitespace', {backgroundImage: 'u\\72\r\nl(a(b);position:fixed;x:())'}],
        ['escaped upper-case: \\55 RL(', {backgroundImage: '\\55 RL(a(b);position:fixed;x:())'}],
        // U+0000 在进入 tokenizer 前变成 U+FFFD（name code point）：\0url( 是另一个函数名，"(" 照常配对
        ['NUL before url(', {backgroundImage: '\u0000url(a(b);position:fixed;x:())'}],
        // \r、\f 和 \n 一样是换行：字符串在这里成为 bad-string 结束
        ['CR inside a string', {content: '"a\r;position:fixed;x:"'}],
        ['FF inside a string', {content: '"a\f;position:fixed;x:"'}],
        // 含 {} 块的声明无效，嵌套解析器把它重新解析成嵌套规则，& 选中元素本身
        ['a {} block in a value (issue)', {color: 'hover, & {position:fixed}'}],
        ['a {} block as the whole value', {color: '{position:fixed}'}],
        // 只有 "--" 后面还有字符才是自定义属性；"--" 本身的 {} 同样被重新解析成规则
        ['"--" is not a custom property', {'--': 'hover, & {position:fixed}'}],
        // "<!--" 是一个 CDO token：后面的 url( 是新的 url token，不是函数 --url(（独立审查发现）
        ['CDO before url( inside a block', {color: '(<!--url(/*));position:fixed;*/))'}],
        ['CDO before a bad url inside a block', {color: '(<!--url(x"));position:fixed;"))'}],
        ['CDO before url( swallows what follows', {color: 'f(<!--url(a")"))'}],
        ['CDO: one value adds a global rule', {color: 'f(<!--url(/*));}body{display:none}x{*/))'}],
    ]
    for (const [name, declarations] of corpus) {
        test(name, () => {
            const {ssr, csr, inlineStyle} = measure({...declarations, marginTop: '3px'})
            expect(csr.inline.position).toBe('static')
            expect(inlineStyle.marginTop).toBe('3px')
            expect({
                sheetRules: csr.injected,
                ssrRules: ssr.injected,
                sheet: diff(csr.inline, csr.sheet),
                ssrInline: diff(csr.inline, ssr.inline),
                ssrSheet: diff(csr.inline, ssr.sheet),
            }).toEqual({sheetRules: [], ssrRules: [], sheet: [], ssrInline: [], ssrSheet: []})
        })
    }
})

describe('#78 legal complex values keep working (stylesheet path and SSR ≡ CSR inline)', () => {
    // 每条都带一个 marginTop：一个值让整条规则被拒时，同一条目里的其他声明一起丢失
    const corpus: [string, Record<string, string>][] = [
        ['quoted url with ";"', {backgroundImage: 'url("a;b.png")'}],
        ['unquoted url', {backgroundImage: 'url(a.png)'}],
        ['unquoted url with spaces around', {backgroundImage: 'url( a.png )'}],
        ['upper-case URL', {backgroundImage: 'URL(a.png)'}],
        ['escaped ")" inside url', {backgroundImage: 'url(a\\29 b.png)'}],
        ['"}" inside an unquoted url', {backgroundImage: 'url(a}b.png)'}],
        ['"{" inside an unquoted url', {backgroundImage: 'url(a{b.png)'}],
        ['data url with ";"', {backgroundImage: 'url(data:image/png;base64,AAAA)'}],
        ['linear-gradient', {backgroundImage: 'linear-gradient(to right, rgb(1, 2, 3), rgb(4, 5, 6))'}],
        ['image-set', {backgroundImage: 'image-set("a.png" 1x, "b.png" 2x)'}],
        ['var() with a fallback', {color: 'var(--c, rgb(1, 2, 3))'}],
        ['custom property used by var()', {'--c': 'rgb(1, 2, 3)', color: 'var(--c)'}],
        ['custom property holding a {} block', {'--json': '{"k": [1, 2]}'}],
        ['custom property with a {} block in the middle', {'--x': 'a {b} c'}],
        ['#url( is a hash token, not url(', {'--h': '#url(a(b);c)'}],
        ['{} inside a function of an ordinary property', {color: 'var(--missing, {a})'}],
        ['content: "{"', {content: '"{"'}],
        ['braces and ";" inside strings', {quotes: '"{" "}"', fontFamily: '"a;b{c}", serif'}],
        ['nested calc()', {width: 'calc(1px + (2px * 3))', height: 'calc(calc(1px + 2px) * 2)'}],
        ['escaped "}" outside a string', {fontFamily: 'a\\}b'}],
        ['"}" inside a comment', {color: 'rgb(1, 2, 3) /* } */'}],
        ['hex escape followed by a newline inside a string', {fontFamily: '"\\41\n", serif'}],
        ['CRLF line continuation inside a string', {fontFamily: '"a\\\r\nb", serif'}],
    ]
    for (const [name, declarations] of corpus) {
        test(name, () => {
            const withMargin = {...declarations, marginTop: '3px'}
            const {ssr, csr, inlineStyle} = measure(withMargin)
            // 值在 CSR 行内确实生效（否则「三边一致」可能只是三边都丢了）
            expect(Object.keys(withMargin).filter(key => !inlineStyle.getPropertyValue(cssPropertyName(key)))).toEqual([])
            expect({
                sheetRules: csr.injected,
                ssrRules: ssr.injected,
                sheet: diff(csr.inline, csr.sheet),
                ssrInline: diff(csr.inline, ssr.inline),
                ssrSheet: diff(csr.inline, ssr.sheet),
            }).toEqual({sheetRules: [], ssrRules: [], sheet: [], ssrInline: [], ssrSheet: []})
        })
    }
})

// key 来自开发者代码，这里是纵深防御：SSR 的 <style> 没有 insertRule 兜底，规则门闩放行的规则必须恰好是一条
describe('#78 style keys cannot add rules to the SSR stylesheet (rule gate)', () => {
    const keys = [
        '@media <!--url(/*){}body{display:none}@media x{*/)',
        '& <!--url(/*){}body{display:none}x{*/)',
        // at-rule 的前言遇到顶层 ";" 就结束，后面的文本成为另一条规则
        '@x;body',
    ]
    for (const key of keys) {
        test(JSON.stringify(key), () => {
            function KeyApp({}: any, {createElement}: RenderContext) {
                return <div id="k" style={{marginTop: '3px', [key]: {color: 'rgb(1, 2, 3)'}}}>x</div>
            }
            const {html, styles} = renderToString(createElement(KeyApp, {}))
            const ssrEl = document.createElement('div')
            ssrEl.innerHTML = `<style>${styles}</style>${html}`
            document.body.appendChild(ssrEl)
            const injected = injectedRules([ssrEl.querySelector('style')!.sheet!], ssrEl.querySelector('#k')!)
            const bodyDisplay = getComputedStyle(document.body).display
            const marginTop = getComputedStyle(ssrEl.querySelector('#k')!).marginTop
            ssrEl.remove()
            expect({injected, bodyDisplay, marginTop}).toEqual({injected: [], bodyDisplay: 'block', marginTop: '3px'})
        })
    }
})

describe('#78 differential fuzz: a declaration the gate accepts parses as exactly that declaration', () => {
    // mulberry32：确定性种子，失败时打印编号与值，可原样重放
    function random(seed: number) {
        return () => {
            seed = (seed + 0x6D2B79F5) | 0
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }
    const NAMES = ['color', 'background-image', 'font-family', 'content', 'width', 'list-style-image', '--x', '--']
    const FRAGMENTS = [
        'url(', 'URL(', 'url(a', 'url( a', '\\75rl(', 'u\\72 l(', 'u\\72\r\nl(', '\\55 RL(', '\\75 \\72 \\6c(', 'f(', 'calc(', 'var(--a, ',
        '(', ')', ')', '[', ']', '{', '}', '"', "'", '"a"', ';', ';', '!', ':', ',', '&', '#', '@', '-', '.', '+', '%', 'e',
        '\\', '\\\n', '\\\r\n', '\\29 ', '\\29', '\\7d', '\\7b ', '\\22', '/*', '*/', '\r', '\f', '\n', '\r\n', ' ', '\t',
        '\u000b', '\u0000', '\u0001', '\u007f', '\u00e9', '<!--', '-->',
        'a', 'b', '1', '1px', 'a.png', 'red', 'rgb(1, 2, 3)', 'position:fixed', 'x:', 'hover, & ',
    ]
    const URL_OPENERS = ['url(', 'URL(', '\\75rl(', 'u\\72 l(', 'url( ', '<!--url(', '(<!--url(', 'f(<!--url(']
    const reference = (name: string, value: string) => {
        const style = document.createElement('div').style
        style.setProperty(name, value)
        style.setProperty('margin-top', '3px')
        return style.cssText
    }
    function problemOf(name: string, value: string, sheet: CSSStyleSheet): string | undefined {
        const expected = reference(name, value)
        const ruleText = `.p {\n${name}:${value};\nmargin-top:3px;\n}`
        // stylesheet 路径（CSR）：insertRule
        try {
            sheet.insertRule(ruleText, 0)
        } catch {
            return 'insertRule threw'
        }
        const rule = sheet.cssRules[0] as CSSStyleRule
        sheet.deleteRule(0)
        if (rule.cssRules.length || rule.style.cssText !== expected) return `insertRule: ${rule.cssText} (expected ${expected})`
        // SSR 的 <style>：没有 insertRule 兜底，后面的规则必须原样存在
        const whole = new CSSStyleSheet()
        whole.replaceSync(`${ruleText}\n.sentinel {color: red}`)
        const [first, second] = Array.from(whole.cssRules) as CSSStyleRule[]
        if (whole.cssRules.length !== 2 || second.selectorText !== '.sentinel' || first.cssRules.length || first.style.cssText !== expected) {
            return `stylesheet: ${Array.from(whole.cssRules).map(r => r.cssText).join(' | ')} (expected ${expected})`
        }
        // SSR 的规则门闩必须放行这条规则（否则 SSR 丢掉整条规则，CSR 保留）
        if (!isAcceptableSingleCssRule(ruleText)) return 'rule gate rejected the rule'
        // SSR 的 style 属性
        const el = document.createElement('div')
        el.setAttribute('style', `${name}:${value};margin-top:3px`)
        if (el.style.cssText !== expected) return `style attribute: ${el.style.cssText} (expected ${expected})`
        return undefined
    }

    test('seeded', () => {
        const sheet = new CSSStyleSheet()
        const failures: string[] = []
        let accepted = 0
        for (const seed of [1, 2, 3, 4, 5]) {
            const next = random(seed * 7919)
            const pick = () => FRAGMENTS[Math.floor(next() * FRAGMENTS.length)]
            for (let n = 0; n < 40000; n++) {
                const name = NAMES[Math.floor(next() * NAMES.length)]
                let value = ''
                if (next() < 0.5) {
                    for (let count = 1 + Math.floor(next() * 10); count > 0; count--) value += pick()
                } else {
                    // url 形状：前缀 + url( + 内容 + ")" + 后缀（随机拼接很少凑出能让 url token 分界起作用的值）
                    for (let count = Math.floor(next() * 3); count > 0; count--) value += pick()
                    value += URL_OPENERS[Math.floor(next() * URL_OPENERS.length)]
                    for (let count = Math.floor(next() * 6); count > 0; count--) value += pick()
                    value += ')'
                    for (let count = Math.floor(next() * 4); count > 0; count--) value += pick()
                }
                if (!isAcceptableInlineDeclaration(name, value)) continue
                accepted++
                const problem = problemOf(name, value, sheet)
                if (problem) failures.push(`seed ${seed} #${n} ${JSON.stringify(name)}: ${JSON.stringify(value)} → ${problem}`)
            }
        }
        expect(failures.slice(0, 8)).toEqual([])
        // 放行的值要足够多，否则这个不变量是空的
        expect(accepted).toBeGreaterThan(20000)
    })

    test('the rule gate accepts only what the browser parses as exactly one rule', () => {
        const next = random(7878)
        const pick = () => FRAGMENTS[Math.floor(next() * FRAGMENTS.length)]
        const failures: string[] = []
        let accepted = 0
        for (let n = 0; n < 40000; n++) {
            // 前言也随机：selector（嵌套 key）与 at-rule 前言（@media 等 key）都来自 style 对象
            let prelude = next() < 0.4 ? '.p' : next() < 0.5 ? '.p ' : '@media '
            if (prelude !== '.p') for (let count = Math.floor(next() * 5); count > 0; count--) prelude += pick()
            let body = ''
            for (let count = Math.floor(next() * 8); count > 0; count--) body += pick()
            const rule = `${prelude} {${body}}`
            if (!isAcceptableSingleCssRule(rule)) continue
            accepted++
            const whole = new CSSStyleSheet()
            whole.replaceSync(`${rule}\n.sentinel {color: red}`)
            const rules = Array.from(whole.cssRules)
            const last = rules[rules.length - 1]
            const before = rules.slice(0, -1)
            // 最多多出这一条规则本身（前言不合法时浏览器整条丢弃），哨兵必须原样在最后
            if (!(last instanceof CSSStyleRule) || last.selectorText !== '.sentinel' || before.length > 1
                || before.some(r => !(r instanceof CSSMediaRule || (r instanceof CSSStyleRule && r.selectorText.startsWith('.p'))))) {
                failures.push(`#${n} ${JSON.stringify(rule)} → ${rules.map(r => r.cssText).join(' | ')}`)
            }
        }
        expect(failures.slice(0, 8)).toEqual([])
        expect(accepted).toBeGreaterThan(1000)
    })
})
