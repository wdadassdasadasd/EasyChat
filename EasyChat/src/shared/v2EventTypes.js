// Shared V2 contract: unsupported events must never advance the durable cursor.
export const V2_EVENT_TYPES = Object.freeze([
  'MESSAGE_UPSERT',
  'MEDIA_STATUS',
  'CONTACT_CHANGED',
  'GROUP_CHANGED',
  'CONTACT_APPLY_CHANGED',
  'SESSION_REPLACED'
])

const V2_EVENT_TYPE_SET = new Set(V2_EVENT_TYPES)

export const isSupportedV2EventType = (type) => V2_EVENT_TYPE_SET.has(type)

export const isV2EventEnvelope = (value = {}) =>
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Number(value.version) === 2 &&
  typeof value.eventId === 'string' &&
  value.eventId.length > 0 &&
  Number.isSafeInteger(Number(value.serverSequence)) &&
  Number(value.serverSequence) >= 0 &&
  typeof value.type === 'string' &&
  isSupportedV2EventType(value.type) &&
  Number.isFinite(Number(value.occurredAt)) &&
  value.payload != null &&
  typeof value.payload === 'object' &&
  !Array.isArray(value.payload)
