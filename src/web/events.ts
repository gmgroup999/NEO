import { EventEmitter } from 'events'

export const neoEvents = new EventEmitter()
neoEvents.setMaxListeners(100)

export interface NeoEvent {
  type: 'telegram_message' | 'memory_saved' | 'status_update'
  channel: 'telegram' | 'web'
  data: {
    preview?: string       // ย่อ message ไม่เกิน 80 ตัว
    model?: string
    costUsd?: number
    latencyMs?: number
    memoryCount?: number
  }
  timestamp: number
}

export function emitNeoEvent(event: NeoEvent) {
  neoEvents.emit('neo', event)
}
