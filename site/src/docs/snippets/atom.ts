// atom: the primitive reactive value.
import { atom, computed } from 'data0'

const firstName = atom('Ada')
const lastName = atom('Lovelace')

// Reading an atom inside computed() subscribes to it.
const fullName = computed(() => `${firstName()} ${lastName()}`)

console.log(fullName()) // "Ada Lovelace"

firstName('Grace')
console.log(fullName()) // "Grace Lovelace" — recomputed automatically
