export type LinkedNode<T> = {
    prev: LinkedNode<T>|null,
    node:T
}

export function createLinkedNode<T>(node:T, prev: LinkedNode<T>|null): LinkedNode<T> {
    return {
        prev,
        node
    }
}
