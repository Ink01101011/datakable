/** Fixed-capacity FIFO: pushing past capacity overwrites the oldest entry (§8.2 bounded memory). */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[]
  private start = 0
  private count = 0

  constructor(readonly capacity: number) {
    this.items = new Array(capacity)
  }

  push(item: T): void {
    const end = (this.start + this.count) % this.capacity
    this.items[end] = item
    if (this.count < this.capacity) this.count++
    else this.start = (this.start + 1) % this.capacity
  }

  /** Oldest first. */
  toArray(): T[] {
    const out: T[] = []
    for (let i = 0; i < this.count; i++) out.push(this.items[(this.start + i) % this.capacity] as T)
    return out
  }

  clear(): void {
    this.items.fill(undefined)
    this.start = 0
    this.count = 0
  }

  get size(): number {
    return this.count
  }
}
