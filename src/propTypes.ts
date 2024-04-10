/**
 * 用法：直接用最后导出的函数就是验证函数。
 * 增强：
 * propType.zeroValue 获取零值。
 * propType.is 可以用来判断是否是某种类型 propType.is(propTypes.func)
 * propType.default(() => defaultValue) 用于生成带有 defaultValue 的 propType
 * propType.required 生成带有 isRequired 标记的 propType
 *
 */

import {Atom, atom, isAtom, RxList, RxMap} from "data0";

export function internalCheckPropTypes() {
}

function isStringLike(v: any) {
    const type = typeof v
    return (type === 'string' || type === 'number')
}


// TODO zero-value
// 这个写法是为了兼容 react 的 prop-types
export function createTypeClass<D extends TypeDefinition>(definition: D) {
    function Type<T>(...argv: any[]): TypeChecker<T, D> {
        function TypeChecker(v: any) {
            if (!TypeChecker.check?.(v)) return new Error('type check failed')
        }

        TypeChecker.argv = argv
        TypeChecker.stringify = definition.stringify?.bind(TypeChecker)
        TypeChecker.parse = definition.parse?.bind(TypeChecker)
        TypeChecker.check = definition.check?.bind(TypeChecker)
        TypeChecker.is = definition.is || (t => t === Type)
        TypeChecker.zeroValue = definition.zeroValue
        TypeChecker.required = definition.required
        TypeChecker.createDefaultValue = definition.createDefaultValue
        TypeChecker.coerce = definition.coerce

        if (!TypeChecker.required) {
            Object.defineProperty(TypeChecker, 'isRequired', {
                get() {
                    return createTypeClass({
                        ...definition,
                        required: true,
                        // CAUTION 注意这里 isRequired.is 和之前一样
                        is: TypeChecker.is,
                    })(...argv)
                },
            })
        }


        if (!TypeChecker.createDefaultValue) {
            // 提供一个 default 函数，可以动态将 TypeChecker 变成带 defaultValue 的(其实是动态再创建的)。
            Object.defineProperty(TypeChecker, 'default', {
                get() {
                    return (createDefaultValue: () => any) => createTypeClass( {
                        ...definition,
                        required: TypeChecker.required,
                        createDefaultValue,
                        is: TypeChecker.is,
                    })(...argv)
                },
            })
        } else {
            Object.defineProperty(TypeChecker, 'defaultValue', {
                get() {
                    if (TypeChecker.createDefaultValue) {
                        return TypeChecker.createDefaultValue!()
                    }
                },
            })
        }

        TypeChecker.valueType = {} as unknown as T

        // FIXME
        // @ts-ignore
        return TypeChecker as unknown as TypeChecker<T>
    }

    return Type
}

export type TypeChecker<T, D extends TypeDefinition> = {
    (v: any): any,
    [k: string] : any
    argv: any[],
    stringify: typeof JSON.stringify,
    parse: typeof JSON.parse,
    check: (obj: any) => boolean,
    is : (obj: any) => boolean,
    required: D["required"] extends true ? true : false,
    createDefaultValue?: () => any,
    default: (createDefaultValue: () => any) => typeof createNormalType
    defaultValue: any,
    coerce?: (v: any) => any,
    valueType: T,
}

export type TypeDefinition = {
    stringify?: (...args: any[]) => any,
    parse?: (...args: any[]) => any,
    check?: (v: any) => boolean,
    is? : (obj: any) => boolean,
    required?: boolean,
    createDefaultValue?: () => any,
    zeroValue? : any,
    coerce?: (v: any) => any,
}


export function createNormalType<T, D extends TypeDefinition>(type: any, definition: D) : TypeChecker<T, D> {
    const {
        stringify = JSON.stringify,
        parse = JSON.parse,
        is,
        required,
        ...rest
    } = definition
    const TypeChecker = function (v: any) {
        if (typeof type === 'function') {
            if (!type(v)) {
                return new Error(`${v} type check failed`)
            }
        }
        if (typeof type === 'string') {
            if (typeof v !== type) {
                return new Error(`${v} is not ${type}`)
            }
        }
    } as TypeChecker<T, D>

    TypeChecker.stringify = stringify
    TypeChecker.parse = parse
    TypeChecker.check = (v) => {
        return (typeof type === 'string') ? (typeof v) === type : type(v)
    }
    TypeChecker.is = is || (t => t === TypeChecker)
    // @ts-ignore
    TypeChecker.required = !!required

    Object.assign(TypeChecker, rest)

    if (!TypeChecker.required) {
        Object.defineProperty(TypeChecker, 'isRequired', {
            get() {
                return createNormalType<T, D&{required:true}>(type, {
                    ...definition,
                    required: true,
                    is: TypeChecker.is,
                })
            },
        })
    }

    if (!TypeChecker.createDefaultValue) {
        // 提供一个 default 函数，可以动态将 TypeChecker 变成带 defaultValue 的(其实是动态再创建的)。
        Object.defineProperty(TypeChecker, 'default', {
            get() {
                return (createDefaultValue: () => any) => createNormalType(type, {
                    ...definition,
                    required: TypeChecker.required,
                    createDefaultValue,
                    is: TypeChecker.is,
                })
            },
        })
    } else {
        Object.defineProperty(TypeChecker, 'defaultValue', {
            get() {
                if (TypeChecker.createDefaultValue) {
                    return TypeChecker.createDefaultValue!()
                }
            },
        })
    }

    TypeChecker.valueType = {} as unknown as T
    return TypeChecker
}


export const oneOf = createTypeClass({
    stringify(this: TypeChecker<any, any>, v: any) {
        if (v === null) return ''
        return isStringLike(this.argv[0][0]) ? v.toString() : JSON.stringify(v)
    },
    parse(this: TypeChecker<any, any>, v: any) {
        return !isStringLike(this.argv[0][0])
            ? JSON.parse(v)
            : ((typeof this.argv[0][0]) === 'string' ? v : parseFloat(v))
    },
    check(this: TypeChecker<any, any>, v: any) {
        return this.argv[0].includes(v)
    },
    zeroValue: [],
})

// TODO 要改成普通JSON.stringify, 剩下的让 editor 处理。
const stringDef = {
    zeroValue: '',
}
export const string = createNormalType<string, typeof stringDef>('string', stringDef)

const numberDef = {
    stringify(v:any) { return v.toString() },
    parse(v:any) {
        if (/-?\d+(\.\d+)?/.test(v)) return parseFloat(v)
        throw new Error(`${v} is not a number`)
    },
    zeroValue: 0,
}
export const number = createNormalType<number, typeof numberDef>('number', numberDef)

const objectDef = { zeroValue: null }
export const object = createNormalType<object, typeof objectDef>((v: any) => {
    return (typeof v === 'object' && !Array.isArray(v))
}, objectDef)

export const array = createNormalType<Array<any>, {}>((v: any) => {
    return Array.isArray(v)
}, {})

const boolDef = { zeroValue: false }
export const bool = createNormalType<boolean, typeof boolDef>('bool', boolDef)

const funcDef = {
    stringify(v: any) { return v.toString() },
    // eslint-disable-next-line no-new-func
    parse(v: any) { return new Function(v) },
}
export const func = createNormalType<Function, typeof funcDef>('function', funcDef)

export const symbol = createNormalType<Symbol, {}>('symbol', {})

const anyDef = {
    stringify() {
        throw new Error('type any can not stringify')
    },
    parse() {
        throw new Error('type any can not parse')
        return false
    },
    check() {
        throw new Error('type any can not check')
        return false
    },
}
export const any = createNormalType<any, typeof anyDef>(() => true, anyDef )

export const oneOfType = createTypeClass({
    check(this: TypeChecker<any, any>, v: any) {
        return this.argv[0].some((propType: TypeChecker<any, any>) => propType.check(v))
    },
    stringify(this: TypeChecker<any, any>, v: any) {
        const propType = this.argv[0].find((propType: TypeChecker<any, any>) => !(propType(v) instanceof Error))
        return propType.stringify(v)
    },
    parse(this: TypeChecker<any, any>, v: any) {
        // TODO 每个都准备 parse 一下
        let result
        const haveResult = this.argv[0].some((propType: TypeChecker<any, any>) => {
            try {
                const parsed = propType.parse(v)
                if (this.check(parsed)) {
                    result = parsed
                    return true
                }
            } catch (e) {

            }
            return false
        })

        if (!haveResult) throw new Error(`can not parse ${v}`)
        return result
    },
})

export const arrayOf = createTypeClass({
    check(this: TypeChecker<any, any>, v: any) {
        if (!Array.isArray(v)) return false
        // TODO of type?
        return v.every(e => this.argv[0].check(e))
    },
    stringify(v) {
        // TODO
        // stringify 时 element 里面有，[ 等符号怎么办
        // 应该始终都用 JSON 格式，至于 editor 要不要有自己的 stringify/parse ，那是它的事情。
    },
    parse(v) {
        // TODO
    },
    zeroValue: [],
})


export const shapeOf = createTypeClass({
    check(v) {
        return true
    },
    stringify(v) {
        // TODO
        // stringify 时 element 里面有，[ 等符号怎么办
    },
    parse(v) {
        // TODO
    },
})

export const map = createTypeClass({
    check(this: TypeChecker<any, any>, v: any) {
        return Object.entries(this.argv[0]).every(([key, propType]: [string, unknown]) => (propType as TypeChecker<any, any>).check(v[key]))
    },
    stringify(this: TypeChecker<any, any>, v: any) {
        // 注意里面对 propType.stringify 结果又用了一次 JSON.stringify 是为了转义双引号
        return `{${Object.entries(this.argv[0]).map(([key, propType]: [string, unknown]) => {
            return `${key}:${JSON.stringify((propType as TypeChecker<any, any>).stringify(v[key]))}`
        }).join(',')}`
    },
    parse(this: TypeChecker<any, any>, v: any) {
        const map = JSON.parse(v)
        Object.keys(map).forEach((key) => {
            map[key] = this.argv[0][key].parse(map[key])
        })
        return map
    },
})


// TODO node/elementType
export const node = any
export const element = any
export const elementType = any

export const checkPropTypes = internalCheckPropTypes

function atomType<T>() {
    return createTypeClass( {
        coerce: (v: any) => {
            return isAtom(v) ? v : atom(v)
        },
    })<Atom<T>>()
}

function rxListType<T>() {
    return createTypeClass( {
        coerce: (v: any) => {
            return v instanceof RxList ? v : new RxList(v)
        },
    })<RxList<T>>()
}

function rxMapType<K, V>() {
    return createTypeClass( {
        coerce: (v: any) => {
            return v instanceof RxMap ? v : new RxMap(v)
        },
    })<RxMap<K, V>>()
}

export default {
    string,
    number,
    object,
    array,
    bool,
    function: func,
    symbol,
    node,
    element,
    elementType,
    // instanceOf

    // 枚举值
    oneOf,
    // 枚举类型
    oneOfType,
    // 数组类型，里面的值应该只能跟类型
    arrayOf,
    // objectOf,
    // 对象结构的嵌套类型。shape + arrayOf + oneOfType + any 可以描述任何 schema。
    shapeOf,
    // map 类型，就是简单的 kv，应该是  shape 的子集。
    map,
    // exact,
    // customProps/customArrayProps
    any,
    checkPropTypes,
    // reactive types
    atom: atomType,
    rxList: rxListType,
    rxMap: rxMapType,
}

export type PropType<T, U extends TypeDefinition> = TypeChecker<T, U>
export type PropTypes = {
    [k: string]: PropType<any, any>
}

export type AllowFixed<T> = T extends RxList<infer U> ? U[]|T :
    T extends RxMap<infer K, infer V> ? [K, V][]|T :
        T extends Atom<infer U> ? U|T : T


type OmitNever<T> = Omit<T, { [K in keyof T]: T[K] extends never ? K : never }[keyof T]>


type ToAllowFixedPropsTypeOptional<T extends PropTypes> = Partial<OmitNever<{
    [K in keyof T]: T[K]['required'] extends true ?
        never :
        AllowFixed<T[K]['valueType']>
}>>

type ToAllowFixedPropsTypeRequired<T extends PropTypes> = OmitNever<{
    [K in keyof T]: T[K]['required'] extends true ?
        AllowFixed<T[K]['valueType']> :
        never
}>

export type ToAllowFixedPropsType<T extends PropTypes> = ToAllowFixedPropsTypeOptional<T> & ToAllowFixedPropsTypeRequired<T>

type ToPropsTypeOptional<T extends PropTypes> = Partial<OmitNever<{
    [K in keyof T]: T[K]['required'] extends true ?
        never :
        T[K]['valueType']
}>>

type ToPropsTypeRequired<T extends PropTypes> = OmitNever<{
    [K in keyof T]: T[K]['required'] extends true ?
        T[K]['valueType'] :
        never
}>

export type ToPropsType<T extends PropTypes> = ToPropsTypeOptional<T> & ToPropsTypeRequired<T>