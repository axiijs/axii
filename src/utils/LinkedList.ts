export class LinkedListNode<T> {
  public value: T;
  public next: LinkedListNode<T> | null = null;
  public prev: LinkedListNode<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

export class LinkedList<T> {
  private headNode: LinkedListNode<T> | null = null;
  private tailNode: LinkedListNode<T> | null = null;
  private sizeValue: number = 0;

  constructor(items?: T[]) {
    if (items) {
      items.forEach(item => this.push(item));
    }
  }

  // Required for spread operator support
  *[Symbol.iterator](): Iterator<T> {
    let current = this.headNode;
    while (current !== null) {
      yield current.value;
      current = current.next;
    }
  }

  // Basic operations
  push(value: T): void {
    const newNode = new LinkedListNode(value);
    this.sizeValue++;

    if (!this.headNode) {
      this.headNode = newNode;
      this.tailNode = newNode;
      return;
    }

    newNode.prev = this.tailNode;
    this.tailNode!.next = newNode;
    this.tailNode = newNode;
  }

  pop(): T | undefined {
    if (!this.tailNode) return undefined;

    const value = this.tailNode.value;
    this.sizeValue--;

    if (this.headNode === this.tailNode) {
      this.headNode = null;
      this.tailNode = null;
      return value;
    }

    this.tailNode = this.tailNode.prev;
    this.tailNode!.next = null;
    return value;
  }

  // Array-like operations
  map<U>(callback: (value: T, index: number) => U): LinkedList<U> {
    const result = new LinkedList<U>();
    let current = this.headNode;
    let index = 0;

    while (current) {
      result.push(callback(current.value, index));
      current = current.next;
      index++;
    }

    return result;
  }

  filter(predicate: (value: T, index: number) => boolean): LinkedList<T> {
    const result = new LinkedList<T>();
    let current = this.headNode;
    let index = 0;

    while (current) {
      if (predicate(current.value, index)) {
        result.push(current.value);
      }
      current = current.next;
      index++;
    }

    return result;
  }

  join(separator: string = ','): string {
    if (!this.headNode) return '';

    let result = '';
    let current: LinkedListNode<T> | null = this.headNode;

    while (current) {
      result += String(current.value);
      if (current.next) {
        result += separator;
      }
      current = current.next;
    }

    return result;
  }

  findLastIndex(predicate: (value: T, index: number) => boolean): number {
    if (!this.tailNode) return -1;

    let current: LinkedListNode<T> | null = this.tailNode;
    let index = this.sizeValue - 1;

    while (current) {
      if (predicate(current.value, index)) {
        return index;
      }
      current = current.prev;
      index--;
    }

    return -1;
  }

  // Utility methods
  clone(): LinkedList<T> {
    return new LinkedList<T>([...this]);
  }

  toArray(): T[] {
    return [...this];
  }

  get length(): number {
    return this.sizeValue;
  }

  get size(): number {
    return this.sizeValue;
  }

  get tail(): LinkedListNode<T> | null {
    return this.tailNode;
  }

  get head(): LinkedListNode<T> | null {
    return this.headNode;
  }

  // Access methods
  get(index: number): T | undefined {
    if (index < 0 || index >= this.sizeValue) return undefined;

    let current = this.headNode;
    for (let i = 0; i < index && current; i++) {
      current = current.next;
    }

    return current?.value;
  }

  getLast(): T | undefined {
    return this.tail?.value;
  }

  getFirst(): T | undefined {
    return this.head?.value;
  }

  // Additional array-like methods that might be needed
  concat(...lists: LinkedList<T>[]): LinkedList<T> {
    const result = this.clone();
    lists.forEach(list => {
      let current = list.headNode;
      while (current) {
        result.push(current.value);
        current = current.next;
      }
    });
    return result;
  }

  slice(start: number = 0, end?: number): LinkedList<T> {
    const result = new LinkedList<T>();
    if (start < 0) start = Math.max(0, this.sizeValue + start);
    if (end === undefined) end = this.sizeValue;
    if (end < 0) end = Math.max(0, this.sizeValue + end);
    const finalEnd = Math.min(end, this.sizeValue);

    let current = this.headNode;
    let index = 0;

    // Skip to start
    while (current && index < start) {
      current = current.next;
      index++;
    }

    // Add elements until end
    while (current && index < finalEnd) {
      result.push(current.value);
      current = current.next;
      index++;
    }

    return result;
  }

  reverse(): LinkedList<T> {
    const result = new LinkedList<T>();
    let current = this.tailNode;
    
    while (current) {
      result.push(current.value);
      current = current.prev;
    }

    return result;
  }
}
