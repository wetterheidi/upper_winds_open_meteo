export class RunningVariance {
  constructor() {
    this.clear()
  }

  clear() {
    this.n = 0
    this.oldM = 0.0
    this.newM = 0.0
    this.oldS = 0.0
    this.newS = 0.0
  }

  push(x) {
    this.n++
    if (this.n === 1) {
      this.oldM = x
      this.newM = x
      this.oldS = 0.0
    } else {
      this.newM = this.oldM + (x - this.oldM) / this.n
      this.newS = this.oldS + (x - this.oldM) * (x - this.newM)
      this.oldM = this.newM
      this.oldS = this.newS
    }
  }

  numDataValues() {
    return this.n
  }

  mean() {
    return this.n > 0 ? this.newM : 0.0
  }

  variance() {
    return this.n > 1 ? this.newS / (this.n - 1) : 0.0
  }

  standardDeviation() {
    return Math.sqrt(this.variance())
  }
}
