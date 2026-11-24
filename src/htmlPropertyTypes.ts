/**
 * HTML 元素上反射 property 的静态类型知识（#51），只有 axii/ssr 使用：服务端没有 DOM 可以问 typeof node[name]，
 * 按这张表推出客户端 DOM.setAttribute 的 property 分支最终留在元素上的 attribute。写入规则与别名表本身在 markupNames
 * （emptyOrBooleanWrite / attributeNameOfProperty / isRawWriteProperty），两端共用；客户端在运行时问 typeof，不读这张表。
 * CAUTION 单独成模块、只被 ssr.ts 引用：打包时 markupNames 落在 axii 与 axii/ssr 共用的 chunk 里，
 *  表放在那里的话会随客户端一起下载并在加载时解析。这里不能访问 document / window：axii/ssr 在纯 Node 环境加载本模块。
 */
import {REMOVE_ATTRIBUTE, WRITE_EMPTY, emptyOrBooleanWrite, isAriaReflectionProperty, isRawWriteProperty} from './markupNames'

/**
 * HTML property 的静态类型（服务端用）：
 *  s DOMString / USVString；z 可空 DOMString（未设置时 getter 返回 null：popover / role / crossOrigin / aria*）；
 *  b boolean；n 数值（long / unsigned long / double）；t DOMTokenList；
 *  k 反射成 "true"/"false" 关键字的 boolean（draggable / spellcheck）；y translate（"yes"/"no"）；h hidden。
 */
export type HtmlPropertyType = 's' | 'z' | 'b' | 'n' | 't' | 'k' | 'y' | 'h'

// CAUTION 这张表回答「客户端 DOM.setAttribute 的 property 分支对这个名字写出什么 attribute」，所以只收：
//  - 按 HTML 标准反射 content attribute 的 IDL 属性（含 §16 已废弃但仍须实现的属性，如 align / bgColor / ch）。
//    不反射的 property（nonce / muted / indeterminate / selected / innerText …）客户端只写 property、不产生 attribute，
//    不在表里，服务端照旧走 attribute 分支；
//  - 不收客户端不走 property 分支的名字：type / list / form（总是 attribute 分支）、value / checked（表单通道，
//    value 在 option / button / data / li / meter / progress 上例外：DOM.setAttribute 的 value 分支原样赋给 property，
//    服务端按 assignAsIs 处理）、disabled / className / style（专门分支）；
//  - 不收浏览器私有的扩展（attributionSrc、credentialless、webkitdirectory、disablePictureInPicture、elementTiming …）。
//  表里每一项都由 __tests__/auditSsrCsrAttributeParity.spec.tsx 的全表比对在真实浏览器里核对（服务端写出的 attribute
//  与客户端完全一致）。客户端不读这张表：它在运行时问 typeof node[name]，权威且不需要额外的查表；
//  客户端产物不包含本模块（见文件头）。
const GLOBAL_PROPERTIES = 's:title,lang,dir,accessKey,autocapitalize,enterKeyHint,inputMode,id,slot,contentEditable,writingSuggestions ' +
    'z:popover,role b:inert,autofocus h:hidden n:tabIndex k:draggable,spellcheck y:translate t:classList,part'
const MEDIA_PROPERTIES = 's:src,preload z:crossOrigin b:autoplay,loop,controls,defaultMuted'
const TABLE_SECTION_PROPERTIES = 's:align,ch,chOff,vAlign'
const TABLE_CELL_PROPERTIES = 's:abbr,align,axis,height,width,ch,chOff,vAlign,bgColor,headers,scope b:noWrap n:colSpan,rowSpan'
const ELEMENT_PROPERTIES: {[tag: string]: string} = {
    a: 's:href,target,download,ping,rel,hreflang,referrerPolicy,coords,charset,name,rev,shape t:relList',
    area: 's:href,alt,coords,shape,target,download,ping,rel,referrerPolicy t:relList b:noHref',
    audio: MEDIA_PROPERTIES,
    base: 's:href,target',
    blockquote: 's:cite',
    br: 's:clear',
    button: 's:formAction,formEnctype,formMethod,formTarget,name,popoverTargetAction,value b:formNoValidate',
    canvas: 'n:width,height',
    caption: 's:align',
    col: 's:align,ch,chOff,vAlign,width n:span',
    colgroup: 's:align,ch,chOff,vAlign,width n:span',
    data: 's:value',
    del: 's:cite,dateTime',
    details: 's:name b:open',
    dialog: 'b:open',
    div: 's:align',
    dl: 'b:compact',
    embed: 's:src,width,height,align,name',
    fieldset: 's:name',
    form: 's:acceptCharset,action,autocomplete,enctype,encoding,method,name,target,rel b:noValidate t:relList',
    h1: 's:align', h2: 's:align', h3: 's:align', h4: 's:align', h5: 's:align', h6: 's:align',
    hr: 's:align,color,size,width b:noShade',
    iframe: 's:src,srcdoc,name,allow,width,height,referrerPolicy,loading,align,scrolling,frameBorder,longDesc,marginHeight,marginWidth ' +
        't:sandbox b:allowFullscreen',
    img: 's:alt,src,srcset,sizes,useMap,referrerPolicy,decoding,loading,fetchPriority,name,lowsrc,align,longDesc,border ' +
        'z:crossOrigin b:isMap n:width,height,hspace,vspace',
    input: 's:accept,alt,autocomplete,defaultValue,dirName,formAction,formEnctype,formMethod,formTarget,max,min,name,pattern,' +
        'placeholder,src,step,popoverTargetAction,align,useMap b:defaultChecked,formNoValidate,multiple,readOnly,required ' +
        'n:height,maxLength,minLength,size,width',
    ins: 's:cite,dateTime',
    label: 's:htmlFor',
    legend: 's:align',
    li: 'n:value',
    link: 's:href,rel,as,media,integrity,hreflang,referrerPolicy,imageSrcset,imageSizes,fetchPriority,charset,rev,target ' +
        'z:crossOrigin t:relList,sizes,blocking',
    map: 's:name',
    menu: 'b:compact',
    meta: 's:name,httpEquiv,content,media,scheme',
    meter: 'n:value,min,max,low,high,optimum',
    object: 's:data,name,useMap,width,height,align,archive,code,codeBase,codeType,standby,border b:declare n:hspace,vspace',
    ol: 'b:reversed,compact n:start',
    optgroup: 's:label',
    option: 's:label,value b:defaultSelected',
    output: 's:name t:htmlFor',
    p: 's:align',
    pre: 'n:width',
    progress: 'n:value,max',
    q: 's:cite',
    script: 's:src,integrity,referrerPolicy,fetchPriority,charset,event,htmlFor z:crossOrigin b:noModule,async,defer t:blocking',
    select: 's:autocomplete,name b:multiple,required n:size',
    slot: 's:name',
    source: 's:src,srcset,sizes,media n:width,height',
    style: 's:media t:blocking',
    table: 's:align,border,frame,rules,summary,width,bgColor,cellPadding,cellSpacing',
    tbody: TABLE_SECTION_PROPERTIES,
    td: TABLE_CELL_PROPERTIES,
    template: 's:shadowRootMode b:shadowRootDelegatesFocus,shadowRootClonable,shadowRootSerializable',
    textarea: 's:autocomplete,dirName,name,placeholder,wrap b:readOnly,required n:cols,rows,maxLength,minLength',
    tfoot: TABLE_SECTION_PROPERTIES,
    th: TABLE_CELL_PROPERTIES,
    thead: TABLE_SECTION_PROPERTIES,
    time: 's:dateTime',
    tr: 's:align,ch,chOff,vAlign,bgColor',
    track: 's:kind,src,srclang,label b:default',
    ul: 'b:compact',
    video: `${MEDIA_PROPERTIES} s:poster b:playsInline n:width,height`,
}

function parsePropertyTypes(spec: string, into: {[name: string]: HtmlPropertyType}): {[name: string]: HtmlPropertyType} {
    for (const group of spec.split(' ')) {
        const type = group[0] as HtmlPropertyType
        for (const name of group.slice(2).split(',')) into[name] = type
    }
    return into
}

const globalPropertyTypes = /* @__PURE__ */ parsePropertyTypes(GLOBAL_PROPERTIES, Object.create(null))
const elementPropertyTypes: {[tag: string]: {[name: string]: HtmlPropertyType}} = /* @__PURE__ */ (() => {
    const out: {[tag: string]: {[name: string]: HtmlPropertyType}} = Object.create(null)
    for (const tag in ELEMENT_PROPERTIES) out[tag] = parsePropertyTypes(ELEMENT_PROPERTIES[tag], Object.create(null))
    return out
})()

/**
 * @internal
 * HTML 元素（小写标签名）上这个名字对应的反射 property 的类型；不是该元素的反射 property 时返回 undefined。
 * 自定义元素（未升级）只有 HTMLElement / Element 上的全局 property。
 */
export function htmlPropertyType(tagLower: string, name: string): HtmlPropertyType | undefined {
    const own = tagLower.indexOf('-') === -1 ? elementPropertyTypes[tagLower]?.[name] : undefined
    return own ?? globalPropertyTypes[name] ?? (isAriaReflectionProperty(name) ? 'z' : undefined)
}

/** @internal 每个 HTML 元素上的反射 property 清单（全局的不重复列出）：给 parity 用例逐项核对。 */
export function htmlPropertyTypeEntries(): {global: {[name: string]: HtmlPropertyType}, elements: {[tag: string]: {[name: string]: HtmlPropertyType}}} {
    return {global: globalPropertyTypes, elements: elementPropertyTypes}
}

// 服务端用的类型样本：喂给 emptyOrBooleanWrite 的 current，typeof（以及 z 的 null）与浏览器里该类型 property 的当前值一致
const PROPERTY_TYPE_SAMPLES: {[type in HtmlPropertyType]: unknown} = {s: '', z: null, b: false, n: 0, t: {}, k: false, y: false, h: false}

// 原样赋一个 boolean 值之后，浏览器按 IDL 类型反射出的 attribute 值（null = 不存在）
function reflectAssignedBoolean(type: HtmlPropertyType, value: boolean): string | null {
    switch (type) {
        case 'b':
        case 'h':
            return value ? '' : null
        case 'n':
            return value ? '1' : '0'
        case 'k':
            return value ? 'true' : 'false'
        case 'y':
            return value ? 'yes' : 'no'
        default:
            // s / z：ToString；t：DOMTokenList 的 value = ToString
            return value ? 'true' : 'false'
    }
}

/**
 * @internal
 * 服务端：HTML 元素上走 property 分支的名字，客户端最终留在元素上的 attribute 值（≡ DOM.setAttribute 的 property 分支
 * + 浏览器反射）。null 表示不输出；undefined 表示这个名字不是该元素的反射 property，调用方按 attribute 分支写。
 * assignAsIs：客户端不经 emptyOrBooleanWrite、原样赋值的分支（DOM.setAttribute 的 value 分支）。
 * 只处理非 nullish 的值（nullish 两端都是不输出）。
 */
export function reflectedPropertyAttributeValue(tagLower: string, name: string, value: unknown, assignAsIs: boolean): string | null | undefined {
    const type = htmlPropertyType(tagLower, name)
    if (type === undefined) return undefined
    if (value === true || value === false) {
        const raw = assignAsIs || tagLower.indexOf('-') !== -1 || isRawWriteProperty(name)
        const code = emptyOrBooleanWrite(raw ? undefined : PROPERTY_TYPE_SAMPLES[type], value)
        if (code & REMOVE_ATTRIBUTE) return null
        // WRITE_NULL 只与 REMOVE_ATTRIBUTE 同时出现
        return code & WRITE_EMPTY ? '' : reflectAssignedBoolean(type, value)
    }
    // 非 boolean 的值：客户端原样赋给 property（setProperty），boolean 型的 property 按真假反射。
    //  数值型 property 的 WebIDL 数值转换（tabIndex="abc" -> 0）不在这里模拟，原样写出。
    switch (type) {
        case 'b':
            return value ? '' : null
        case 'k':
        case 'y':
            // 字符串值是 HTML 关键字，DOM.setAttribute 把它原样写成 attribute（draggable="false" / translate="no"）
            return typeof value === 'string' ? value : reflectAssignedBoolean(type, !!value)
        case 'h': {
            // hidden 的 setter：0 / NaN / '' 移除；字符串 until-found（不区分大小写）写 until-found；其余写 ''
            if (typeof value === 'number') return value === 0 || value !== value ? null : ''
            const text = String(value)
            if (text === '') return null
            return text.toLowerCase() === 'until-found' ? 'until-found' : ''
        }
        default:
            return String(value)
    }
}

