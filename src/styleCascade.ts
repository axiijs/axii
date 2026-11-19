import {type PreparedStyleContent, serializePreparedStyle} from './styleSerialize'

export type StyleSheetOrder = {
    entryIndex: number
    hasDirectDeclarations: boolean
    signature: string
}

export function getStyleSheetOrder(
    entryIndex: number,
    prepared: PreparedStyleContent,
    signature?: string,
): StyleSheetOrder {
    return {
        entryIndex,
        hasDirectDeclarations: !!(prepared.node.declarations || prepared.node.animation),
        signature: signature ?? serializePreparedStyle(prepared),
    }
}

/**
 * Independently mounted trees can share a stylesheet. Its entry index and CSS
 * determine its source order in every tree.
 */
export function compareStyleSheetOrder(a: StyleSheetOrder, b: StyleSheetOrder): number {
    if (a.entryIndex !== b.entryIndex) return a.entryIndex - b.entryIndex
    // Keep the client-side precedence of a parent's purely nested rules over
    // a direct child declaration when both selectors have equal specificity.
    if (a.hasDirectDeclarations !== b.hasDirectDeclarations) {
        return a.hasDirectDeclarations ? -1 : 1
    }
    if (a.signature < b.signature) return -1
    if (a.signature > b.signature) return 1
    return 0
}
