import {atom} from "data0";
import {RectRefObject, RefObject} from "./DOM.js";

export function createRef(): RefObject {
    return {
        current: null
    }
}

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

export function createRectRef(options: RectRefObject['options'] = {}): RectRefObject {
   return {
       current: null,
       options
   }
}

export function createRxRectRef(options: RectRefObject['options'] = {}): RectRefObject {
    const ref = atom<RectRefObject>(null)
    let syncMethod: RectRefObject['sync'] = undefined

    return new Proxy({}, {
        get:(_, key) => {
            if (key === 'current') {
                return ref()
            } else if (key === 'options') {
                return options
            } else if (key === 'sync') {
                return syncMethod
            }
        },
        set: (_, key, value) => {
            if (key === 'current') {
                ref(value)
            } else if ( key === 'sync') {
                syncMethod = value
            }
            return true
        }
    }) as RectRefObject
}

