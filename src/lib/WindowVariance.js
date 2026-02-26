import { RunningVariance } from './RunningVariance'
import { CircularBuffer } from './CircularBuffer'

export class WindowVariance extends RunningVariance {
  constructor(windowSize) {
    super()
    this.cb = new CircularBuffer(windowSize)
  }

  /**
   * Add a new value to the window
   */
  add(x) {
    this.cb.push(x)
  }

  /**
   * Calculate the variance of the current window
   */
  variance() {
    this.clear()
    for (const value of this.cb) {
      this.push(value)
    }
    return super.variance()
  }

  /**
   * Calculate the mean of the current window
   */
  mean() {
    this.variance() // This will compute both variance and mean
    return super.mean()
  }

  /**
   * Get the window size
   */
  getWindowSize() {
    return this.cb.capacity()
  }

  /**
   * Get the current number of values in the window
   */
  getCurrentSize() {
    return this.cb.size()
  }

  /**
   * Check if the window is full
   */
  isFull() {
    return this.cb.isFull()
  }

  /**
   * Clear the window and reset statistics
   */
  clearWindow() {
    this.cb.clear()
    this.clear()
  }

  /**
   * Get the standard deviation of the current window
   */
  standardDeviation() {
    return Math.sqrt(this.variance())
  }

  /**
   * Get all values currently in the window
   */
  getValues() {
    return this.cb.toArray()
  }
}
