export class CircularBuffer {
  constructor(capacity) {
    this.buffer = new Array(capacity)
    this.maxSize = capacity
    this.head = 0
    this.tail = 0
    this.full = false
  }

  push(item) {
    this.buffer[this.head] = item
    this.head = (this.head + 1) % this.maxSize
    if (this.full) {
      this.tail = (this.tail + 1) % this.maxSize // Move tail when overwriting
    } else if (this.head === this.tail) {
      this.full = true // Mark as full when head catches up to tail
    }
  }

  pop() {
    if (this.empty()) {
      return null
    }
    const output = this.buffer[this.tail]
    this.tail = (this.tail + 1) % this.maxSize
    this.full = false
    return output
  }

  empty() {
    return !this.full && this.head === this.tail
  }

  isFull() {
    return this.full
  }

  size() {
    if (this.full) return this.maxSize
    if (this.head >= this.tail) return this.head - this.tail
    return this.maxSize + this.head - this.tail
  }

  capacity() {
    return this.maxSize
  }

  clear() {
    this.head = 0
    this.tail = 0
    this.full = false
  }

  // Iterator support using JavaScript's Symbol.iterator
  *[Symbol.iterator]() {
    if (this.empty()) {
      return
    }

    let position = this.tail
    let count = 0
    const size = this.size()

    while (count < size) {
      yield this.buffer[position]
      position = (position + 1) % this.maxSize
      count++
    }
  }

  toArray() {
    return Array.from(this)
  }

  peek() {
    if (this.empty()) {
      return null
    }
    return this.buffer[this.tail]
  }
}
