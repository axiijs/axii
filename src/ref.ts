import {atom} from "data0";
import {RefObject} from "./DOM.js";

/**
 * @category Basic
 */
export function createRef(): RefObject {
    return {
        current: null
    }
}

/**
 * @category Basic
 */
export function createRxRef(): RefObject {
    const ref = atom<RefObject>(null)

    return new Proxy({}, {
        get:(_, key) => {
            if (key === 'current') {
                return ref()
            }
        },
        set: (_, key, value) => {
            if (key === 'current') {
                ref(value)
            }
            return true
        }
    }) as RefObject
}

