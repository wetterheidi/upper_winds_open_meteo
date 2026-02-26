import { currentQNH } from '../process/qnh'
import { altitudeByPressure, isaToQnhAltitude } from '../utils/meteo-utils'
import { Kalman } from './kalman'

let historySamples = 5
let decimateEKFSamples = 1

let pressure
let rawAltitudeISA = 0.0
let currentVariance = 0.0

let ekfAltitudeISA = 0
let ekfVelocity = 0
let ekfAcceleration = 0

let ekfVspeedStdDev = 0
let ekfVaccelStdDev = 0

const ekf = new Kalman()

let previousTimestamp = 0 // seconds / Unix timestamp
let sampleCounter = 0 // Counter for EKF sample decimation

// Initialize EKF history windows
function setHistorySamples(newSampleCount) {
  historySamples = newSampleCount
  console.log(`historySamples: ${newSampleCount}`)
  ekf.setAltitudeVarianceHistoryWindow(newSampleCount)
  ekf.setVspeedStdDevHistoryWindow(newSampleCount)
  ekf.setVaccelStdDevHistoryWindow(newSampleCount)
}

// Run initial setup
setHistorySamples(historySamples)

function processPressureSample(pressure, t) {
  const altISA = altitudeByPressure(pressure, 1013.25)
  if (!altISA) {
    return
  }
  rawAltitudeISA = altISA

  if (previousTimestamp > 0) {
    const timeDiff = t - previousTimestamp
    ekf.altitudeSample(timeDiff, altISA, 0, 0)
    sampleCounter++
    if (sampleCounter >= decimateEKFSamples) {
      currentVariance = ekf.currentVariance()
      ekfAltitudeISA = ekf.getAltitude()
      ekfVelocity = ekf.getVelocity()
      ekfAcceleration = ekf.getAcceleration()
      ekfVspeedStdDev = ekf.vspeedstandardDeviation()
      ekfVaccelStdDev = ekf.vaccelstandardDeviation()
      sampleCounter = 0
    }
  }
  previousTimestamp = t
}

const zCI95 = 1.96

function vspeedCI95() {
  return {
    lower: ekfVelocity - zCI95 * ekfVspeedStdDev,
    upper: ekfVelocity + zCI95 * ekfVspeedStdDev,
  }
}

function vaccelCI95() {
  return {
    lower: ekfAcceleration - zCI95 * ekfVaccelStdDev,
    upper: ekfAcceleration + zCI95 * ekfVaccelStdDev,
  }
}

export {
  historySamples,
  pressure,
  rawAltitudeISA,
  ekfAltitudeISA,
  ekfVelocity,
  ekfAcceleration,
  ekfVaccelStdDev,
  ekfVspeedStdDev,
  currentVariance,
  vspeedCI95,
  vaccelCI95,
  processPressureSample,
  decimateEKFSamples,
  setHistorySamples,
}
