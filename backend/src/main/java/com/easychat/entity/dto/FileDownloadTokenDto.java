package com.easychat.entity.dto;

import java.io.Serializable;

public class FileDownloadTokenDto implements Serializable {
    private String userId;
    private Long messageId;
    private Boolean showCover;
    private Boolean download;

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public Long getMessageId() {
        return messageId;
    }

    public void setMessageId(Long messageId) {
        this.messageId = messageId;
    }

    public Boolean getShowCover() {
        return showCover;
    }

    public void setShowCover(Boolean showCover) {
        this.showCover = showCover;
    }

    public Boolean getDownload() {
        return download;
    }

    public void setDownload(Boolean download) {
        this.download = download;
    }
}
