// RxList: a reactive array. Mutations (push/splice/move) produce incremental
// list patches — only the affected rows are inserted/moved, never the whole list.
import { RxList } from 'data0'

const todos = new RxList([
  { text: 'write docs', done: false },
])

todos.push({ text: 'ship site', done: false })   // inserts a new row
todos.splice(0, 1)                                // removes the first row
todos.move(0, 1)                                  // row identity is preserved
