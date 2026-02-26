/**
 * Exponentially Weighted Moving Variance (EWMV)
 * Computes variance with exponentially decaying weights on historical data
 *
 * The algorithm maintains both an exponentially weighted moving average (EWMA)
 * for the mean and an EWMA for the variance using the online update formula:
 *   diff = x - mean
 *   incr = alpha * diff
 *   mean = mean + incr
 *   variance = (1 - alpha) * (variance + diff * incr)
 *
 * where alpha is the weight on new data (0 < alpha <= 1).
 * Higher alpha = more responsive to recent changes
 * Lower alpha = smoother, more historical weight
 */
export class ExponentialWeightedVariance {
  constructor(alpha = 0.1) {
    this.alpha = alpha
    this.meanValue = 0
    this.varianceValue = 0
    this.count = 0
  }

  getAlpha() {
    return this.alpha
  }

  setAlpha(alpha) {
    this.alpha = alpha
  }

  mean() {
    return this.meanValue
  }

  variance() {
    return this.varianceValue
  }

  standardDeviation() {
    return Math.sqrt(this.varianceValue)
  }

  numDataValues() {
    return this.count
  }

  push(x) {
    const diff = x - this.meanValue
    const incr = this.alpha * diff
    this.meanValue += incr
    this.varianceValue = (1.0 - this.alpha) * (this.varianceValue + diff * incr)
    this.count++
  }

  clear() {
    this.meanValue = 0
    this.varianceValue = 0
    this.count = 0
  }

  isInitialized() {
    return this.count > 0
  }

  clone() {
    const copy = new ExponentialWeightedVariance(this.alpha)
    copy.meanValue = this.meanValue
    copy.varianceValue = this.varianceValue
    copy.count = this.count
    return copy
  }
}
