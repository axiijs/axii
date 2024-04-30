/**
 * @vitest-environment jsdom
 */
import { createElement, PropType, FixedCompatiblePropsType, PropTypes, PropsType} from "@framework";
import { assertType } from 'vitest'
import {Atom, atom, RxList} from "data0";


const AppPropTypes = {
    a: PropTypes.number.default(() =>1),
    b: PropTypes.atom<string>().isRequired,
    c: PropTypes.rxList<string>(),
    d: PropTypes.atom<any>()
}

assertType<PropType<number, {}>>(AppPropTypes.a)
assertType<typeof AppPropTypes.d>(null as unknown as never)

function App(props: FixedCompatiblePropsType<typeof AppPropTypes>) {
    const {b, d} = props as PropsType<typeof App.propTypes>
    return <div>
        <span>{b}</span>
        <span>{d}</span>
    </div>
}

App.propTypes = AppPropTypes

assertType<JSX.ElementClass>(App)

assertType<false>(PropTypes.number.required)

assertType<typeof App.propTypes>({
    a: {} as unknown as PropType<number, {}>,
    b: {} as unknown as PropType<Atom<string>, {
        required: true,
        coerce: (v: any) => any;
    }>,
    c: {} as unknown as PropType<RxList<string>, {
        coerce: (v: any) => any;
    }>,
    d:  {} as unknown as PropType<Atom<any>, {
        coerce: (v: any) => any;
    }>,
})

assertType<false>(App.propTypes.a.required)
assertType<FixedCompatiblePropsType<typeof App.propTypes>>({a: 1, b: "1", c: ["1"]})
assertType<FixedCompatiblePropsType<typeof App.propTypes>>({a: 1, b: atom("1")})
assertType<FixedCompatiblePropsType<typeof App.propTypes>>({b:"2", c: new RxList(["1"])})


const app = <App a={1} b={atom('a')} as="root"/>
const app2 = <App a={1} b={atom('a')} c={["1"]}/>
console.log(app, app2)
//
//
// type Config = {
//     required?: boolean
// }
// //
// // // 根据参数 config 中的 required 字段类型返回 true|false
// type Result<A, T extends Config> = T['required'] extends true ? {type: A, isRequired: true } : {type: A, isRequired: false };
// //
// function createObject<A, T extends Config>(config: T): Result<A, T> {
//     const isRequired = config.required === true;
//     return {value: {} , isRequired } as unknown as Result<A, T>;
// }
//
// // // 测试
// // const newObj1 = createObject({ required: true }); // 类型为 { isRequired: true }
// // console.log(newObj1); // 输出：{ isRequired: true }
// //
// // const newObj2 = createObject<any, any>({ required: false }); // 类型为 { isRequired: false }
// // console.log(newObj2); // 输出：{ isRequired: false }
// // assertType<true>(newObj1.isRequired)
//
// const newObj3 = createObject({ }); // 类型为 { isRequired: false }
// assertType<false>(newObj3.isRequired)

// type TypeChecker<T, D extends TypeDefinition> = {
//     required: D["required"] extends true ? true : false,
// }
//
// function createNormalType<A, T extends Config>(definition: T) : Result<A, T> {
//     function TypeChecker() {}
//     return TypeChecker as unknown as Result<A, T>
// }
//
// const number1 = createNormalType({})
// assertType<false>(number1.isRequired)

// const a = function() {}
// const b = {}
// const
// type AT = typeof a
// type ISO = AT extends object ? true:false
// assertType<ISO>(true)
//
//
// // type AtomBase =
//
// type Atom<T = any> = T extends object ? (T & {
//     __v_isAtom: true;
//     raw: T;
// } & {
//     (newValue?: any): T;
// }) : {
//     __v_isAtom: true;
//     raw: T;
// } & {
//     (newValue?: any): T;
// };
//
// assertType<Atom<any>>({} as unknown as never)
// assertType<any>({} as unknown as Atom<any>)

// type ISA = never extends any ? true : false
// // assertType<ISA>(false)
// assertType<never>(null as unknown as Atom<any>)
// type ISAO = any extends object ? true : false
// assertType<false>(null as unknown as ISAO)
//
// type Combined = any & {():  void}
// assertType<never>(null as unknown as Combined)
// type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] }
// // type OmitNever<T> = Omit<T, { [K in keyof T]: T[K] extends never ? K : never }[keyof T]>
// const a = {
//     a: null as unknown as Atom<any>
// }
// type A = typeof a
// type AA = OmitNever<typeof a>
// assertType<Atom<any>>(null as unknown as A["a"])
// assertType<Atom<any>>(null as unknown as AA["a"])