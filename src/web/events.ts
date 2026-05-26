import { EventEmitter } from 'events'

export const neoEvents = new EventEmitter()
neoEvents.setMaxListeners(100)

export interface NeoEvent {
  type: 'telegram_message' | 'memory_saved' | 'status_update' | 'cron_start' | 'cron_done' | 'cron_error' | 'cost_alert' | 'deploy_requested'
  channel: 'telegram' | 'web' | 'system'
  data: Record<string, any>
  timestamp: number
}

export function emitNeoEvent(event: NeoEvent) {
  neoEvents.emit('neo', event)
}
