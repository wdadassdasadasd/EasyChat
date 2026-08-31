package com.easychat.entity.query;


import java.util.List;

/**
 * 鑱婂ぉ娑堟伅琛ㄥ弬鏁?
 */
public class ChatMessageQuery extends BaseParam {


    /**
     * 娑堟伅鑷ID
     */
    private Long messageId;

    /**
     * 浼氳瘽ID
     */
    private String sessionId;

    private String sessionIdFuzzy;

    /**
     * 娑堟伅绫诲瀷
     */
    private Integer messageType;

    /**
     * 娑堟伅鍐呭
     */
    private String messageContent;

    private String messageContentFuzzy;

    /**
     * 鍙戦€佷汉ID
     */
    private String sendUserId;

    private String sendUserIdFuzzy;

    /**
     * 鍙戦€佷汉鏄电О
     */
    private String sendUserNickName;

    private String sendUserNickNameFuzzy;

    /**
     * 鍙戦€佹椂闂?
     */
    private Long sendTime;

    /**
     * 鎺ユ敹鑱旂郴浜篒D
     */
    private String contactId;

    private String contactIdFuzzy;

    /**
     * 鑱旂郴浜虹被鍨?0:鍗曡亰 1:缇よ亰
     */
    private Integer contactType;

    /**
     * 鏂囦欢澶у皬
     */
    private Long fileSize;

    /**
     * 鏂囦欢鍚?
     */
    private String fileName;

    private String fileNameFuzzy;

    /**
     * 鏂囦欢绫诲瀷
     */
    private Integer fileType;

    /**
     * 鐘舵€?0:姝ｅ湪鍙戦€?1:宸插彂閫?
     */
    private Integer status;


    private List<String> contactIdList;


    private Long lastReceiveTime;

    public void setMessageId(Long messageId) {
        this.messageId = messageId;
    }

    public Long getMessageId() {
        return this.messageId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public String getSessionId() {
        return this.sessionId;
    }

    public void setSessionIdFuzzy(String sessionIdFuzzy) {
        this.sessionIdFuzzy = sessionIdFuzzy;
    }

    public String getSessionIdFuzzy() {
        return this.sessionIdFuzzy;
    }

    public void setMessageType(Integer messageType) {
        this.messageType = messageType;
    }

    public Integer getMessageType() {
        return this.messageType;
    }

    public void setMessageContent(String messageContent) {
        this.messageContent = messageContent;
    }

    public String getMessageContent() {
        return this.messageContent;
    }

    public void setMessageContentFuzzy(String messageContentFuzzy) {
        this.messageContentFuzzy = messageContentFuzzy;
    }

    public String getMessageContentFuzzy() {
        return this.messageContentFuzzy;
    }

    public void setSendUserId(String sendUserId) {
        this.sendUserId = sendUserId;
    }

    public String getSendUserId() {
        return this.sendUserId;
    }

    public void setSendUserIdFuzzy(String sendUserIdFuzzy) {
        this.sendUserIdFuzzy = sendUserIdFuzzy;
    }

    public String getSendUserIdFuzzy() {
        return this.sendUserIdFuzzy;
    }

    public void setSendUserNickName(String sendUserNickName) {
        this.sendUserNickName = sendUserNickName;
    }

    public String getSendUserNickName() {
        return this.sendUserNickName;
    }

    public void setSendUserNickNameFuzzy(String sendUserNickNameFuzzy) {
        this.sendUserNickNameFuzzy = sendUserNickNameFuzzy;
    }

    public String getSendUserNickNameFuzzy() {
        return this.sendUserNickNameFuzzy;
    }

    public void setSendTime(Long sendTime) {
        this.sendTime = sendTime;
    }

    public Long getSendTime() {
        return this.sendTime;
    }

    public void setContactId(String contactId) {
        this.contactId = contactId;
    }

    public String getContactId() {
        return this.contactId;
    }

    public void setContactIdFuzzy(String contactIdFuzzy) {
        this.contactIdFuzzy = contactIdFuzzy;
    }

    public String getContactIdFuzzy() {
        return this.contactIdFuzzy;
    }

    public void setContactType(Integer contactType) {
        this.contactType = contactType;
    }

    public Integer getContactType() {
        return this.contactType;
    }

    public void setFileSize(Long fileSize) {
        this.fileSize = fileSize;
    }

    public Long getFileSize() {
        return this.fileSize;
    }

    public void setFileName(String fileName) {
        this.fileName = fileName;
    }

    public String getFileName() {
        return this.fileName;
    }

    public void setFileNameFuzzy(String fileNameFuzzy) {
        this.fileNameFuzzy = fileNameFuzzy;
    }

    public String getFileNameFuzzy() {
        return this.fileNameFuzzy;
    }

    public void setFileType(Integer fileType) {
        this.fileType = fileType;
    }

    public Integer getFileType() {
        return this.fileType;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public Integer getStatus() {
        return this.status;
    }

    public List<String> getContactIdList() {
        return contactIdList;
    }

    public void setContactIdList(List<String> contactIdList) {
        this.contactIdList = contactIdList;
    }


    public Long getLastReceiveTime() {
        return lastReceiveTime;
    }

    public void setLastReceiveTime(Long lastReceiveTime) {
        this.lastReceiveTime = lastReceiveTime;
    }
}


