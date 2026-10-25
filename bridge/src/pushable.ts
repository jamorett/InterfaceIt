/** An async iterable you can push into: the SDK reads the user's prompts from one of these for as long as the session lives. */
export class Pushable<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiter?: (r: IteratorResult<T>) => void;
  private closed = false;

  push(v: T) {
    if (this.closed) return;
    if (this.waiter) {
      this.waiter({ value: v, done: false });
      this.waiter = undefined;
    } else this.items.push(v);
  }

  end() {
    this.closed = true;
    this.waiter?.({ value: undefined as never, done: true });
    this.waiter = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () =>
        this.items.length ? Promise.resolve({ value: this.items.shift()!, done: false })
        : this.closed ? Promise.resolve({ value: undefined as never, done: true })
        : new Promise((r) => { this.waiter = r; }),
    };
  }
}
