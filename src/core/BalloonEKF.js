import * as math from 'mathjs'

class BalloonEKF {
  constructor() {
    this.x = math.matrix([0.0, 0.0, 0.0, 0.1]) // k = 0.1 m/s^3 per loudness-duration unit

    this.P = math.multiply(math.identity(4), 10.0)
    this.P.subset(math.index(3, 3), 1.0)

    this.Q = math.zeros(4, 4)
    this.Q.subset(math.index(0, 0), 0.01)
    this.Q.subset(math.index(1, 1), 0.01)
    this.Q.subset(math.index(2, 2), 0.001)
    this.Q.subset(math.index(3, 3), 0.001)

    this.R = math.matrix([[0.1]])

    this.H = math.matrix([[1.0, 0.0, 0.0, 0.0]])

    this.F = math.zeros(2, 2)

    this.initialized = false
  }

  processMeasurement(dt, altitude, loudness, duration) {
    if (!this.initialized) {
      this.x.subset(math.index(0), altitude)
      this.initialized = true
      return
    }
    const loudnessDuration = loudness * duration
    this._predict(dt, loudnessDuration)
    this._update(altitude)
  }

  setVariance(variance) {
    this.R.subset(math.index(0, 0), variance)
  }

  _predict(dt, loudnessDuration) {
    const x_pred = math.matrix([
      this.x.get([0]) + this.x.get([1]) * dt + 0.5 * this.x.get([2]) * dt * dt,
      this.x.get([1]) + this.x.get([2]) * dt,
      this.x.get([2]) + this.x.get([3]) * loudnessDuration,
      this.x.get([3]),
    ])

    this.F = math.identity(4)
    this.F.subset(math.index(0, 1), dt)
    this.F.subset(math.index(0, 2), 0.5 * dt * dt)
    this.F.subset(math.index(1, 2), dt)
    this.F.subset(math.index(2, 3), loudnessDuration)

    this.x = x_pred
    this.P = math.add(
      math.multiply(math.multiply(this.F, this.P), math.transpose(this.F)),
      this.Q,
    )
  }

  _update(altitude) {
    const z = math.matrix([altitude])
    const y = math.subtract(z, math.multiply(this.H, this.x))

    const S = math.add(
      math.multiply(math.multiply(this.H, this.P), math.transpose(this.H)),
      this.R,
    )

    const K = math.multiply(
      math.multiply(this.P, math.transpose(this.H)),
      math.inv(S),
    )

    this.x = math.add(this.x, math.multiply(K, y))

    const I = math.identity(4)
    this.P = math.multiply(math.subtract(I, math.multiply(K, this.H)), this.P)
  }

  isDecelerating() {
    if (!this.initialized) {
      return { isDecelerating: false, timeToZeroSpeed: 0 }
    }

    const v = this.x.get([1])
    const a = this.x.get([2])

    if (v * a < 0) {
      const timeToZeroSpeed = -v / a
      return { isDecelerating: true, timeToZeroSpeed }
    }
    return { isDecelerating: false, timeToZeroSpeed: 0 }
  }

  getZeroSpeedAltitude() {
    if (!this.initialized) {
      return { valid: false, altitude: 0 }
    }

    const h = this.x.get([0])
    const v = this.x.get([1])
    const a = this.x.get([2])

    if (v * a < 0) {
      const t = -v / a
      const altitude = h + v * t + 0.5 * a * t * t
      return { valid: true, altitude }
    }
    return { valid: false, altitude: 0 }
  }

  getAltitude() {
    return this.x.get([0])
  }

  getVelocity() {
    return this.x.get([1])
  }

  getAcceleration() {
    return this.x.get([2])
  }

  getBurnerGain() {
    return this.x.get([3])
  }
}

export default BalloonEKF
