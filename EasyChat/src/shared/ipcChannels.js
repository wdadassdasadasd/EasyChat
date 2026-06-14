const IPC_CALLBACK_CHANNELS = Object.freeze({
  clearChatMessage: 'clearChatMessageCallback',
  deleteChatSession: 'delChatSessionCallback',
  getLocalStore: 'getLocalStoreCallback',
  loadChatMessage: 'loadChatMessageCallback',
  loadSessionData: 'loadSessionDataCallback',
  markSessionRead: 'markSessionReadCallback',
  searchChatMessage: 'searchChatMessageCallback',
  topChatSession: 'topChatSessionCallback'
})

export { IPC_CALLBACK_CHANNELS }
