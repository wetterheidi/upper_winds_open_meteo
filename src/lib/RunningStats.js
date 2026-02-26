export const ConfidenceInterval = {
  CI90: 0,
  CI95: 1,
  CI99: 2,
}

export class RunningStats {
  // Z-values for confidence intervals: 90%, 95%, 99%
  static Z_VALUES = [1.645, 1.96, 2.576]

  constructor() {
    this.clear()
  }

  /**
   * Reset all statistics to initial state
   */
  clear() {
    this.n = 0
    this.M1 = 0.0
    this.M2 = 0.0
    this.M3 = 0.0
    this.M4 = 0.0
  }

  /**
   * Add a new value to the statistics
   * @param x The value to add
   */
  push(x) {
    const n1 = this.n
    this.n++

    const delta = x - this.M1
    const delta_n = delta / this.n
    const delta_n2 = delta_n * delta_n
    const term1 = delta * delta_n * n1

    this.M1 += delta_n
    this.M4 +=
      term1 * delta_n2 * (this.n * this.n - 3 * this.n + 3) +
      6 * delta_n2 * this.M2 -
      4 * delta_n * this.M3
    this.M3 += term1 * delta_n * (this.n - 2) - 3 * delta_n * this.M2
    this.M2 += term1
  }

  /**
   * Get the number of values added
   */
  numDataValues() {
    return this.n
  }

  /**
   * Get the mean of the values
   */
  mean() {
    return this.M1
  }

  /**
   * Get the sample variance (n-1 denominator)
   */
  variance() {
    return this.n > 1 ? this.M2 / (this.n - 1.0) : 0.0
  }

  /**
   * Get the population variance (n denominator)
   */
  populationVariance() {
    return this.n > 0 ? this.M2 / this.n : 0.0
  }

  /**
   * Get the standard deviation
   */
  standardDeviation() {
    return Math.sqrt(this.variance())
  }

  /**
   * Get the skewness
   */
  skewness() {
    if (this.n === 0 || this.M2 === 0) return 0.0
    return (Math.sqrt(this.n) * this.M3) / Math.pow(this.M2, 1.5)
  }

  /**
   * Get the kurtosis
   */
  kurtosis() {
    if (this.n === 0 || this.M2 === 0) return 0.0
    return (this.n * this.M4) / (this.M2 * this.M2) - 3.0
  }

  /**
   * Get the confidence interval
   * @param ci The confidence interval type (ConfidenceInterval enum value)
   */
  confidenceInterval(ci) {
    if (this.n < 30) return NaN
    if (ci < ConfidenceInterval.CI90 || ci > ConfidenceInterval.CI99) return NaN
    return (RunningStats.Z_VALUES[ci] * this.standardDeviation()) / Math.sqrt(this.n)
  }

  /**
   * Combine two RunningStats instances
   * @param other The other RunningStats instance to combine with
   * @return A new combined RunningStats instance
   */
  combine(other) {
    const combined = new RunningStats()
    combined.n = this.n + other.n
    if (combined.n === 0) return combined

    const delta = other.M1 - this.M1
    const delta2 = delta * delta
    const delta3 = delta * delta2
    const delta4 = delta2 * delta2

    combined.M1 = (this.n * this.M1 + other.n * other.M1) / combined.n
    combined.M2 = this.M2 + other.M2 + (delta2 * this.n * other.n) / combined.n

    combined.M3 =
      this.M3 +
      other.M3 +
      (delta3 * this.n * other.n * (this.n - other.n)) / (combined.n * combined.n)
    combined.M3 += (3.0 * delta * (this.n * other.M2 - other.n * this.M2)) / combined.n

    combined.M4 =
      this.M4 +
      other.M4 +
      (delta4 *
        this.n *
        other.n *
        (this.n * this.n - this.n * other.n + other.n * other.n)) /
        (combined.n * combined.n * combined.n)
    combined.M4 +=
      (6.0 * delta2 * (this.n * this.n * other.M2 + other.n * other.n * this.M2)) /
        (combined.n * combined.n) +
      (4.0 * delta * (this.n * other.M3 - other.n * this.M3)) / combined.n

    return combined
  }

  /**
   * Add another RunningStats instance to this one
   */
  add(other) {
    const combined = this.combine(other)
    this.n = combined.n
    this.M1 = combined.M1
    this.M2 = combined.M2
    this.M3 = combined.M3
    this.M4 = combined.M4
    return this
  }

  /**
   * Create a copy of this RunningStats instance
   */
  clone() {
    const copy = new RunningStats()
    copy.n = this.n
    copy.M1 = this.M1
    copy.M2 = this.M2
    copy.M3 = this.M3
    copy.M4 = this.M4
    return copy
  }
}
