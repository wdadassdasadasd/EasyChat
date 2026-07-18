const createScopeDiagnostics = () => ({
  state: 'idle',
  failureCount: 0,
  pendingCount: 0,
  lastSuccessAt: 0,
  lastErrorKind: 'unknown'
})

let synchronization = {
  eventSync: createScopeDiagnostics(),
  readReceipt: createScopeDiagnostics()
}

const resetSyncRuntimeDiagnostics = () => {
  synchronization = {
    eventSync: createScopeDiagnostics(),
    readReceipt: createScopeDiagnostics()
  }
}

const reportSyncRuntimeDiagnostics = (payload) => {
  const previous = synchronization[payload.scope]
  synchronization[payload.scope] = {
    ...previous,
    state: payload.state,
    pendingCount: payload.pendingCount,
    failureCount: payload.failureCount,
    lastSuccessAt: payload.lastSuccessAt,
    lastErrorKind: payload.lastErrorKind
  }
}

const getSyncRuntimeDiagnostics = () => ({
  eventSync: { ...synchronization.eventSync },
  readReceipt: { ...synchronization.readReceipt }
})

export {
  getSyncRuntimeDiagnostics,
  reportSyncRuntimeDiagnostics,
  resetSyncRuntimeDiagnostics
}
