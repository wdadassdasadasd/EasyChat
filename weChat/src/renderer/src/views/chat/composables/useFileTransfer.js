import { ref } from 'vue';
import Utils from '@/utils/Utils';

export const useFileTransfer = ({ proxy }) => {
    const selectedFileMessage = ref(null);
    const showFilePreviewDialog = ref(false);
    const isReceivingFile = ref(false);

    const openFilePreviewDialog = (message) => {
        if (!Utils.isFileMessage(message)) {
            return;
        }
        selectedFileMessage.value = message;
        showFilePreviewDialog.value = true;
    };

    const closeFilePreviewDialog = () => {
        selectedFileMessage.value = null;
        isReceivingFile.value = false;
    };

    const downloadFileMessage = async (message) => {
        if (!Utils.isFileMessage(message) || message.status == 0) {
            return false;
        }

        const blob = await proxy.Request({
            url: proxy.Api.downloadFile,
            params: {
                fileId: message.messageId,
                showCover: false
            },
            responseType: 'blob',
            showLoading: false
        });

        if (!blob) {
            return false;
        }

        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = Utils.getFileMessageName(message);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
        }, 1000);
        return true;
    };

    const receiveSelectedFileMessage = async () => {
        if (!selectedFileMessage.value || Utils.isFileReceiveDisabled(selectedFileMessage.value)) {
            return;
        }

        isReceivingFile.value = true;
        const isDownloaded = await downloadFileMessage(selectedFileMessage.value);
        isReceivingFile.value = false;
        if (isDownloaded) {
            showFilePreviewDialog.value = false;
        }
    };

    return {
        closeFilePreviewDialog,
        isReceivingFile,
        openFilePreviewDialog,
        receiveSelectedFileMessage,
        selectedFileMessage,
        showFilePreviewDialog
    };
};
