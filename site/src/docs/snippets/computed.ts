// computed: a derived reactive value. Re-evaluates only when a dependency it
// actually read changes. Reads establish the dependency graph automatically.
import { atom, computed } from 'data0'

const price = atom(100)
const quantity = atom(3)
const total = computed(() => price() * quantity())

console.log(total()) // 300
price(120)
console.log(total()) // 360 — recomputed because price changed
