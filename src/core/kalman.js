// in honor of Hilmar Lorenz
// https://www.hlballon.com/brennersteuerung.php

import BalloonEKF from './BalloonEKF'
import { WindowVariance } from '../lib/WindowVariance'

export class Kalman extends BalloonEKF {
  constructor() {
    super()
    this.altiudeVarianceWindowSize = 5
    this.vspeedHistoryWindowSize = 5
    this.vaccelHistoryWindowSize = 5
    this.windowedAltiudeVariance = 0
    this.altiudeVarianceHistory = new WindowVariance(this.altiudeVarianceWindowSize)
    this.vspeedHistory = new WindowVariance(this.vspeedHistoryWindowSize)
    this.vaccelHistory = new WindowVariance(this.vaccelHistoryWindowSize)
  }

  altitudeSample(deltaT, altitude, loudness = 0, duration = 0) {
    this.altiudeVarianceHistory.add(altitude)
    this.windowedAltiudeVariance = this.altiudeVarianceHistory.variance()
    this.setVariance(this.windowedAltiudeVariance)
    this.processMeasurement(deltaT, altitude, loudness, duration)
    this.vspeedHistory.add(this.getVelocity())
    this.vaccelHistory.add(this.getAcceleration())
  }

  setAltitudeVarianceHistoryWindow(samples) {
    this.altiudeVarianceWindowSize = samples
    this.altiudeVarianceHistory = new WindowVariance(this.altiudeVarianceWindowSize)
  }

  setVspeedStdDevHistoryWindow(samples) {
    this.vspeedHistoryWindowSize = samples
    this.vspeedHistory = new WindowVariance(this.vspeedHistoryWindowSize)
  }

  setVaccelStdDevHistoryWindow(samples) {
    this.vaccelHistoryWindowSize = samples
    this.vaccelHistory = new WindowVariance(this.vaccelHistoryWindowSize)
  }

  currentVariance() {
    return this.windowedAltiudeVariance
  }

  vspeedstandardDeviation() {
    return this.vspeedHistory.standardDeviation()
  }

  vaccelstandardDeviation() {
    return this.vaccelHistory.standardDeviation()
  }

  // prime the KF to quickly converge once real samples come
  setAltitude(altitude) {
    for (let i = 0; i < this.altiudeVarianceWindowSize; i++) {
      this.altitudeSample(i, altitude)
    }
  }
}
