import { computed, onBeforeUnmount, ref } from 'vue'
import Utils from '@/utils/Utils'
import { usePendingMediaDrafts } from './composer/usePendingMediaDrafts'

/**
 * Owns text input and composer UI state. Attachment draft ownership lives in
 * usePendingMediaDrafts so it can be tested and cleaned independently.
 */
export const useMessageComposer = ({ currentChatSession, emit }) => {
  const msgContent = ref('')
  const showEmojiPopover = ref(false)
  const showSendMessagePopover = ref(false)
  const mediaDrafts = usePendingMediaDrafts()

  const canSend = computed(
    () =>
      Boolean((msgContent.value || '').trim()) ||
      mediaDrafts.pendingImageList.value.length > 0 ||
      mediaDrafts.pendingFileList.value.length > 0
  )

  const closePopover = () => {
    showEmojiPopover.value = false
    showSendMessagePopover.value = false
  }

  const showEmojiPopoverHandler = () => {
    showEmojiPopover.value = !showEmojiPopover.value
  }

  const sendEmoji = (item) => {
    msgContent.value = (msgContent.value || '') + item
  }

  const sendMessage = () => {
    const messageContent = (msgContent.value || '').trim()
    if (!messageContent && !mediaDrafts.pendingMediaList.value.length) {
      showSendMessagePopover.value = true
      return
    }

    showSendMessagePopover.value = false
    mediaDrafts.dispatchPendingMedia((media) => {
      const eventName =
        media.mediaType === 'image'
          ? 'sendImageMessage'
          : media.fileType === 1
            ? 'sendVideoMessage'
            : 'sendFileMessage'
      emit(eventName, {
        contactId: currentChatSession.value.contactId,
        contactType: currentChatSession.value.contactType,
        file: media.file,
        cover: media.cover,
        uploadSourceId: media.uploadSourceId
      })
    })

    if (messageContent) {
      emit('sendMessage', {
        contactId: currentChatSession.value.contactId,
        contactType: currentChatSession.value.contactType,
        messageContent
      })
      msgContent.value = ''
    }
  }

  onBeforeUnmount(mediaDrafts.cleanup)

  return {
    canSend,
    closePopover,
    dragoverHandler: mediaDrafts.dragoverHandler,
    dropHandler: mediaDrafts.dropHandler,
    fileLimit: mediaDrafts.fileLimit,
    formatFileSize: Utils.formatFileSize,
    msgContent,
    pasteHandler: mediaDrafts.pasteHandler,
    pendingFileList: mediaDrafts.pendingFileList,
    pendingImageList: mediaDrafts.pendingImageList,
    pendingMediaList: mediaDrafts.pendingMediaList,
    removePendingFile: mediaDrafts.removePendingFile,
    removePendingImage: mediaDrafts.removePendingImage,
    sendEmoji,
    sendMessage,
    showEmojiPopover,
    showEmojiPopoverHandler,
    showSendMessagePopover,
    uploadExceed: mediaDrafts.uploadExceed,
    uploadFile: mediaDrafts.uploadFile,
    uploadRef: mediaDrafts.uploadRef
  }
}
