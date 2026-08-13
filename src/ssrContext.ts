/**
 * Short-lived SSR string-pass flag.
 * Used by lazy() to skip startLoad() during renderToString (design §3.3.a).
 * Main-package CSR pays at most a boolean/depth check; no SSR bundle import required.
 */
let ssrPassDepth = 0

export function beginSsrPass(): void {
    ssrPassDepth++
}

export function endSsrPass(): void {
    ssrPassDepth--
}

export function isSsrPass(): boolean {
    return ssrPassDepth > 0
}
