import { Barometer } from '@mhaberler/capacitor-barometer'
import { processPressureSample } from './pressure'

let barometerAvailable = false
let baroActive = false
let baroListener

async function startBarometer() {
  if (baroActive) return
  try {
    const result = await Barometer.isAvailable()
    barometerAvailable = result.available

    if (!barometerAvailable) {
      console.warn('Barometer is not available on this device')
      return
    }

    if (barometerAvailable && !baroActive) {
      baroListener = await Barometer.addListener('onPressureChange', (data) => {
        processPressureSample(data.pressure, data.timestamp)
        // console.log(data.pressure, data.timestamp)
      })
      await Barometer.start({ interval: 500 })
      baroActive = true
      console.log('Barometer started successfully')
    }
  } catch (error) {
    console.error('Failed to start barometer:', error)
    barometerAvailable = false
    baroActive = false
  }
}

async function stopBarometer() {
  if (!baroActive) return
  try {
    await Barometer.stop()
    if (baroListener) {
      await baroListener.remove()
    }
    baroActive = false
    console.log('Barometer stopped successfully')
  } catch (error) {
    console.error('Failed to stop barometer:', error)
    baroActive = false
  }
}

export { barometerAvailable, baroActive, startBarometer, stopBarometer }
