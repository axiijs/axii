import { expect } from "@jest/globals";

type toPrimitiveType = {
    [Symbol.toPrimitive]: Function
}

function toShallowMatchObject<T extends any[]>(received: T, toMatch: T) : { pass: boolean, message: () => string}
function toShallowMatchObject<T extends object>(received: T, toMatch: T) : { pass: boolean, message: () => string}
function toShallowMatchObject(received: any, toMatch: any) {
    let passed = false
    if (Array.isArray(toMatch)) {
        passed = toMatch.every((item, key) => {
            return item == received[key]
        }) && (received as any[]).length === toMatch.length
    } else {
        // const al = Object.keys(toMatch).length
        // const bl = Object.keys(received).length
        debugger
        passed = Object.keys(toMatch).length === Object.keys(received).length &&
            Object.keys(toMatch).every((key) => {
                debugger
                return toMatch[key] == received[key]
            })
    }

    if (passed) {
        return {
            pass: true,
            message: () => `expected "${received.join(',')}" shallow match "${toMatch.join(',')}".`
        }
    } else {
        return {
            pass: false,
            message: () => `expected "${received.join(',')}" shallow equal "${toMatch}".`
        }
    }
}

expect.extend({
    toShallowEqual(received: toPrimitiveType, toMatch: string|number) {
        const passed = (received as unknown as typeof toMatch) == toMatch
        if (passed) {
            return {
                pass: true,
                message: () => `expected "${received[Symbol.toPrimitive]()}" shallow equal "${toMatch}".`
            }
        } else {
            return {
                pass: false,
                message: () => `expected "${received[Symbol.toPrimitive]()}" shallow equal "${toMatch}".`
            }
        }
    },
    toShallowMatchObject,
})
