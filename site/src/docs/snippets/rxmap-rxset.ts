// RxMap / RxSet: reactive keyed & unique collections.
import { RxMap, RxSet } from 'data0'

// RxMap — keyed reactive entries (used by Form values, see Form.tsx).
const filters = new RxMap<string, boolean>()
filters.set('open', true)
filters.delete('open')

// RxSet — unique membership, reactive end-to-end.
const selected = new RxSet<number>([1, 2])
selected.add(3)
selected.delete(1)
