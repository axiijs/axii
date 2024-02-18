/**
 * @vitest-environment jsdom
 */
import {createElement, createRoot} from "@framework";
import { assertType } from 'vitest'

const el = <div></div>

assertType<JSX.Element>(el)
assertType<Element>(el)
assertType<HTMLElement>(el as HTMLElement)


createRoot(el as HTMLElement).render(<div></div>)