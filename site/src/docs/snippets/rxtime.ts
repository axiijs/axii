// RxTime: a reactive clock. Reading it inside a computed / function node
// re-evaluates on each tick.
import { RxTime, computed } from 'data0'

const now = new RxTime(1000) // ticks every 1000ms
const label = computed(() => `now: ${new Date(now()).toLocaleTimeString()}`)
