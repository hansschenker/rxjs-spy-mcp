/**
 * Fixed-capacity buffer with monotonically increasing entry indices, so
 * consumers can poll incrementally with `since(nextIndex)` and detect
 * dropped entries.
 */
export class RingBuffer<T> {
  private buffer_: { index: number; item: T }[] = [];
  private nextIndex_ = 0;

  constructor(private readonly capacity_: number) {}

  get nextIndex(): number {
    return this.nextIndex_;
  }

  get size(): number {
    return this.buffer_.length;
  }

  clear(): void {
    this.buffer_ = [];
  }

  push(item: T): number {
    const index = this.nextIndex_;
    this.nextIndex_ += 1;
    this.buffer_.push({ index, item });
    if (this.buffer_.length > this.capacity_) {
      this.buffer_.shift();
    }
    return index;
  }

  since(index: number, limit: number): { index: number; item: T }[] {
    const result: { index: number; item: T }[] = [];
    if (limit <= 0) {
      return result;
    }
    for (const entry of this.buffer_) {
      if (entry.index < index) {
        continue;
      }
      result.push(entry);
      if (result.length >= limit) {
        break;
      }
    }
    return result;
  }
}
