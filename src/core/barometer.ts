import { ref } from 'vue'
import { Barometer } from '@mhaberler/capacitor-barometer'
import type { PluginListenerHandle } from '@capacitor/core'
import { RateStats } from '../stats/RateStats'
import { processPressureSample } from '@/process/pressure'

interface BarometerAvailable {
  available: boolean
}

interface BarometerData {
  pressure: number
  timestamp: number
}

const barometerAvailable = ref<boolean>(false)
const baroActive = ref(false)
const baroRate = ref<number>(0.0)

let baroListener: PluginListenerHandle
const barometer = Barometer

const rateStats = new RateStats()

async function startBarometer() {
  if (baroActive.value) return
  try {
    const result = (await barometer.isAvailable()) as BarometerAvailable
    barometerAvailable.value = result.available

    if (!barometerAvailable.value) {
      console.warn('Barometer is not available on this device')
      return
    }

    if (barometerAvailable.value && !baroActive.value) {
      baroListener = await barometer.addListener('onPressureChange', (data: BarometerData) => {
        // Only process every decimateEKFSamples samples
        rateStats.push()
        baroRate.value = rateStats.averageRate()
        processPressureSample(data.pressure, data.timestamp)
      })
      await barometer.start({ interval: 500 })
      baroActive.value = true
      console.log('Barometer started successfully')
      rateStats.clear()
    }
  } catch (error) {
    console.error('Failed to start barometer:', error)
    rateStats.clear()
    baroRate.value = 0.0
    barometerAvailable.value = false
    baroActive.value = false
  }
}

async function stopBarometer() {
  rateStats.clear()
  baroRate.value = 0.0
  if (!baroActive.value) return
  try {
    await barometer.stop()
    if (baroListener) {
      await baroListener.remove()
    }
    baroActive.value = false
    console.log('Barometer stopped successfully')
  } catch (error) {
    console.error('Failed to stop barometer:', error)
    // Still set as inactive even if stop failed
    baroActive.value = false
  }
}

export { barometerAvailable, baroActive, baroRate, startBarometer, stopBarometer }
