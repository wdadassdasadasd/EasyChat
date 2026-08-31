package com.easychat.service.impl;

import com.easychat.entity.config.AppConfig;
import com.easychat.entity.constants.Constants;
import com.easychat.entity.dto.MessageSendDto;
import com.easychat.entity.dto.SysSettingDto;
import com.easychat.entity.dto.TokenUserInfoDto;
import com.easychat.entity.enums.*;
import com.easychat.entity.po.ChatMessage;
import com.easychat.entity.po.ChatSession;
import com.easychat.entity.po.UserContact;
import com.easychat.entity.query.ChatMessageQuery;
import com.easychat.entity.query.ChatSessionQuery;
import com.easychat.entity.query.SimplePage;
import com.easychat.entity.query.UserContactQuery;
import com.easychat.entity.vo.PaginationResultVO;
import com.easychat.exception.BusinessException;
import com.easychat.mappers.ChatMessageMapper;
import com.easychat.mappers.ChatSessionMapper;
import com.easychat.mappers.UserContactMapper;
import com.easychat.redis.RedisComponet;
import com.easychat.service.ChatMessageService;
import com.easychat.service.ChatEventOutboxService;
import com.easychat.utils.CopyTools;
import com.easychat.utils.DateUtil;
import com.easychat.utils.StringTools;
import jodd.util.ArraysUtil;
import org.apache.commons.codec.digest.DigestUtils;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.jdbc.core.JdbcTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;


/**
 * 聊天消息表 业务接口实现
 */
@Service("chatMessageService")
public class ChatMessageServiceImpl implements ChatMessageService {

    private static final Logger logger = LoggerFactory.getLogger(ChatMessageServiceImpl.class);
    @Resource
    private ChatMessageMapper<ChatMessage, ChatMessageQuery> chatMessageMapper;

    @Resource
    private ChatSessionMapper<ChatSession, ChatSessionQuery> chatSessionMapper;

    @Resource
    private AppConfig appConfig;

    @Resource
    private UserContactMapper<UserContact, UserContactQuery> userContactMapper;

    @Resource
    private RedisComponet redisComponet;

    @Resource
    private ChatEventOutboxService chatEventOutboxService;

    @Resource
    private RedissonClient redissonClient;

    @Resource
    private JdbcTemplate jdbcTemplate;

    /**
     * 根据条件查询列表
     */
    @Override
    public List<ChatMessage> findListByParam(ChatMessageQuery param) {
        return this.chatMessageMapper.selectList(param);
    }

    /**
     * 根据条件查询列表
     */
    @Override
    public Integer findCountByParam(ChatMessageQuery param) {
        return this.chatMessageMapper.selectCount(param);
    }

    /**
     * 分页查询方法
     */
    @Override
    public PaginationResultVO<ChatMessage> findListByPage(ChatMessageQuery param) {
        int count = this.findCountByParam(param);
        int pageSize = param.getPageSize() == null ? PageSize.SIZE15.getSize() : param.getPageSize();

        SimplePage page = new SimplePage(param.getPageNo(), count, pageSize);
        param.setSimplePage(page);
        List<ChatMessage> list = this.findListByParam(param);
        PaginationResultVO<ChatMessage> result = new PaginationResultVO(count, page.getPageSize(), page.getPageNo(), page.getPageTotal(), list);
        return result;
    }

    /**
     * 新增
     */
    @Override
    public Integer add(ChatMessage bean) {
        return this.chatMessageMapper.insert(bean);
    }

    /**
     * 批量新增
     */
    @Override
    public Integer addBatch(List<ChatMessage> listBean) {
        if (listBean == null || listBean.isEmpty()) {
            return 0;
        }
        return this.chatMessageMapper.insertBatch(listBean);
    }

    /**
     * 批量新增或者修改
     */
    @Override
    public Integer addOrUpdateBatch(List<ChatMessage> listBean) {
        if (listBean == null || listBean.isEmpty()) {
            return 0;
        }
        return this.chatMessageMapper.insertOrUpdateBatch(listBean);
    }

    /**
     * 多条件更新
     */
    @Override
    public Integer updateByParam(ChatMessage bean, ChatMessageQuery param) {
        StringTools.checkParam(param);
        return this.chatMessageMapper.updateByParam(bean, param);
    }

    /**
     * 多条件删除
     */
    @Override
    public Integer deleteByParam(ChatMessageQuery param) {
        StringTools.checkParam(param);
        return this.chatMessageMapper.deleteByParam(param);
    }

    /**
     * 根据MessageId获取对象
     */
    @Override
    public ChatMessage getChatMessageByMessageId(Long messageId) {
        return this.chatMessageMapper.selectByMessageId(messageId);
    }

    /**
     * 根据MessageId修改
     */
    @Override
    public Integer updateChatMessageByMessageId(ChatMessage bean, Long messageId) {
        return this.chatMessageMapper.updateByMessageId(bean, messageId);
    }

    /**
     * 根据MessageId删除
     */
    @Override
    public Integer deleteChatMessageByMessageId(Long messageId) {
        return this.chatMessageMapper.deleteByMessageId(messageId);
    }


    @Override
    @Transactional(rollbackFor = Exception.class)
    public MessageSendDto saveMessage(ChatMessage chatMessage, TokenUserInfoDto tokenUserInfoDto) {
        if (StringTools.isEmpty(chatMessage.getClientMessageId())) {
            // Internal system messages do not originate from a retrying client.
            chatMessage.setClientMessageId(UUID.randomUUID().toString());
        }
        // Do not pre-read the idempotency key here: two HTTP retries can both
        // observe "missing".  insertIfAbsent below is the single atomic
        // decision point, and the duplicate branch reads the original row.
        //不是机器人回复，判断好友状态
        if (!Constants.ROBOT_UID.equals(tokenUserInfoDto.getUserId())) {
            List<String> contactList = redisComponet.getUserContactList(tokenUserInfoDto.getUserId());
            if (!contactList.contains(chatMessage.getContactId())) {
                UserContactTypeEnum userContactTypeEnum = UserContactTypeEnum.getByPrefix(chatMessage.getContactId());
                if (UserContactTypeEnum.USER == userContactTypeEnum) {
                    throw new BusinessException(ResponseCodeEnum.CODE_902);
                } else {
                    throw new BusinessException(ResponseCodeEnum.CODE_903);
                }
            }
        }
        String sessionId = null;
        String sendUserId = tokenUserInfoDto.getUserId();
        String contactId = chatMessage.getContactId();
        Long curTime = System.currentTimeMillis();
        UserContactTypeEnum contactTypeEnum = UserContactTypeEnum.getByPrefix(contactId);
        MessageTypeEnum messageTypeEnum = MessageTypeEnum.getByType(chatMessage.getMessageType());
        String lastMessage = chatMessage.getMessageContent();
        String messageContent = StringTools.resetMessageContent(chatMessage.getMessageContent());
        chatMessage.setMessageContent(messageContent);
        Integer status = MessageTypeEnum.MEDIA_CHAT == messageTypeEnum ? MessageStatusEnum.SENDING.getStatus() : MessageStatusEnum.SENDED.getStatus();
        if (ArraysUtil.contains(new Integer[]{
                MessageTypeEnum.CHAT.getType(),
                MessageTypeEnum.GROUP_CREATE.getType(),
                MessageTypeEnum.ADD_FRIEND.getType(),
                MessageTypeEnum.MEDIA_CHAT.getType()
        }, messageTypeEnum.getType())) {
            if (UserContactTypeEnum.USER == contactTypeEnum) {
                sessionId = StringTools.getChatSessionId4User(new String[]{sendUserId, contactId});
            } else {
                sessionId = StringTools.getChatSessionId4Group(contactId);
            }
            //更新会话消息
            ChatSession chatSession = new ChatSession();
            chatSession.setLastMessage(messageContent);
            if (UserContactTypeEnum.GROUP == contactTypeEnum && !MessageTypeEnum.GROUP_CREATE.getType().equals(messageTypeEnum.getType())) {
                chatSession.setLastMessage(tokenUserInfoDto.getNickName() + "：" + messageContent);
            }
            lastMessage = chatSession.getLastMessage();
            //如果是媒体文件
            chatSession.setLastReceiveTime(curTime);
            //记录消息消息表
            chatMessage.setSessionId(sessionId);
            chatMessage.setSendUserId(sendUserId);
            chatMessage.setSendUserNickName(tokenUserInfoDto.getNickName());
            chatMessage.setSendTime(curTime);
            chatMessage.setContactType(contactTypeEnum.getType());
            chatMessage.setStatus(status);
            Integer inserted = chatMessageMapper.insertIfAbsent(chatMessage);
            if (inserted == null || inserted == 0) {
                ChatMessage duplicate = chatMessageMapper.selectBySendUserIdAndClientMessageId(
                        sendUserId, chatMessage.getClientMessageId());
                if (duplicate == null) {
                    throw new IllegalStateException("idempotency row disappeared after duplicate insert");
                }
                return CopyTools.copy(duplicate, MessageSendDto.class);
            }
            chatSessionMapper.updateBySessionId(chatSession, sessionId);
        }
        MessageSendDto messageSend = CopyTools.copy(chatMessage, MessageSendDto.class);
        if (Constants.ROBOT_UID.equals(contactId)) {
            SysSettingDto sysSettingDto = redisComponet.getSysSetting();
            TokenUserInfoDto robot = new TokenUserInfoDto();
            robot.setUserId(sysSettingDto.getRobotUid());
            robot.setNickName(sysSettingDto.getRobotNickName());
            ChatMessage robotChatMessage = new ChatMessage();
            robotChatMessage.setContactId(sendUserId);
            //这里可以对接Ai 根据输入的信息做出回答
            robotChatMessage.setMessageContent("我只是一个机器人无法识别你的消息");
            robotChatMessage.setMessageType(MessageTypeEnum.CHAT.getType());
            saveMessage(robotChatMessage, robot);
        } else {
            // The dispatcher publishes only after this transaction commits. A
            // duplicate HTTP retry therefore cannot update sessions or emit a
            // second business event. Media remains invisible until its object
            // is READY, so it must not affect recipient unread state here.
            if (MessageTypeEnum.MEDIA_CHAT != messageTypeEnum) {
                chatEventOutboxService.incrementUnreadForVisibleMessage(messageSend);
                chatEventOutboxService.enqueueMessage(messageSend);
            }
        }
        return messageSend;
    }

    private String getSafeFileSuffix(String fileName) {
        if (StringTools.isEmpty(fileName) || !fileName.contains(".")) {
            return "";
        }
        return StringTools.getFileSuffix(fileName);
    }

    private ChatMessage getSenderMessage(String userId, Long messageId) {
        ChatMessage message = chatMessageMapper.selectByMessageId(messageId);
        if (null == message) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        if (!message.getSendUserId().equals(userId)) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        return message;
    }

    private void publishMediaVisible(Long messageId) {
        ChatMessage persisted = chatMessageMapper.selectByMessageId(messageId);
        if (persisted == null) return;
        MessageSendDto payload = CopyTools.copy(persisted, MessageSendDto.class);
        chatEventOutboxService.incrementUnreadForVisibleMessage(payload);
        chatEventOutboxService.enqueueEvent("MESSAGE_UPSERT",
                UserContactTypeEnum.getByPrefix(payload.getContactId()).name(), payload.getContactId(),
                payload, System.currentTimeMillis());
    }

    private void publishMediaTerminalState(ChatMessage message, int status) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("messageId", message.getMessageId());
        payload.put("status", status);
        chatEventOutboxService.enqueueEvent("MEDIA_STATUS", "USER", message.getSendUserId(),
                payload, System.currentTimeMillis());
    }

    private void claimUploadFinalization(Long messageId) {
        int claimed = jdbcTemplate.update(
                "update chat_message set upload_state='FINALIZING' where message_id=? and (upload_state='PENDING' or upload_state is null)",
                messageId);
        if (claimed == 1) return;
        String state = jdbcTemplate.queryForObject("select upload_state from chat_message where message_id=?", String.class, messageId);
        if ("READY".equals(state) || "FAILED".equals(state)) {
            throw new UploadAlreadyFinalizedException();
        }
        throw new BusinessException("上传任务正在收尾，请稍后重试");
    }

    private void finishUploadFinalization(Long messageId, String state) {
        int changed = jdbcTemplate.update("update chat_message set upload_state=? where message_id=? and upload_state='FINALIZING'", state, messageId);
        if (changed != 1) throw new IllegalStateException("upload state transition lost");
    }

    private static class UploadAlreadyFinalizedException extends RuntimeException { }

    private File getMessageFolder(ChatMessage message) {
        String month = DateUtil.format(new Date(message.getSendTime()), DateTimePatternEnum.YYYYMM.getPattern());
        File folder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_FILE + month);
        if (!folder.exists()) {
            folder.mkdirs();
        }
        return folder;
    }

    private File getMessageFile(ChatMessage message, String fileName) {
        return new File(getMessageFolder(message).getPath() + "/" + message.getMessageId() + getSafeFileSuffix(fileName));
    }

    private File getUploadTempFolder(Long messageId, String uploadId) {
        validateUploadId(uploadId);
        File folder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_TEMP + "upload/" + messageId + "/" + uploadId);
        if (!folder.exists()) {
            folder.mkdirs();
        }
        return folder;
    }

    private File getUploadMetaFile(File tempFolder) {
        return new File(tempFolder.getPath() + "/upload.properties");
    }

    private File getUploadTerminalMetaFile(Long messageId) {
        File folder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_TEMP + "upload/" + messageId);
        if (!folder.exists()) {
            folder.mkdirs();
        }
        return new File(folder, "terminal.properties");
    }

    private void saveUploadTerminalState(Long messageId, String state, String uploadId) {
        Properties properties = new Properties();
        properties.setProperty("state", state);
        properties.setProperty("uploadId", uploadId == null ? "" : uploadId);
        try (FileOutputStream outputStream = new FileOutputStream(getUploadTerminalMetaFile(messageId))) {
            properties.store(outputStream, "EasyChat upload terminal state");
        } catch (Exception e) {
            logger.error("保存上传终态失败", e);
            throw new BusinessException("保存上传终态失败");
        }
    }

    private Properties getUploadTerminalState(Long messageId) {
        File metaFile = getUploadTerminalMetaFile(messageId);
        if (!metaFile.exists()) {
            return null;
        }
        Properties properties = new Properties();
        try (FileInputStream inputStream = new FileInputStream(metaFile)) {
            properties.load(inputStream);
            return properties;
        } catch (Exception e) {
            logger.warn("读取上传终态失败", e);
            return null;
        }
    }

    private void saveUploadMeta(File tempFolder, String uploadId, String fileName, Long fileSize, Integer totalChunks) {
        Properties properties = new Properties();
        properties.setProperty("uploadId", uploadId);
        properties.setProperty("fileName", fileName);
        properties.setProperty("fileSize", String.valueOf(fileSize));
        properties.setProperty("totalChunks", String.valueOf(totalChunks));
        try (FileOutputStream outputStream = new FileOutputStream(getUploadMetaFile(tempFolder))) {
            properties.store(outputStream, "EasyChat upload session");
        } catch (Exception e) {
            logger.error("保存上传会话失败", e);
            throw new BusinessException("创建上传会话失败");
        }
    }

    private Properties getUploadMeta(Long messageId, String uploadId) {
        validateUploadId(uploadId);
        File folder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_TEMP + "upload/" + messageId + "/" + uploadId);
        File metaFile = getUploadMetaFile(folder);
        if (!folder.exists() || !metaFile.exists()) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        Properties properties = new Properties();
        try (FileInputStream inputStream = new FileInputStream(metaFile)) {
            properties.load(inputStream);
            return properties;
        } catch (Exception e) {
            logger.error("读取上传会话失败", e);
            throw new BusinessException("上传会话不可用");
        }
    }

    private void checkUploadMeta(Long messageId, String uploadId, String fileName, Long fileSize, Integer totalChunks) {
        Properties properties = getUploadMeta(messageId, uploadId);
        if (!uploadId.equals(properties.getProperty("uploadId"))
                || !String.valueOf(fileName).equals(properties.getProperty("fileName"))
                || !String.valueOf(fileSize).equals(properties.getProperty("fileSize"))
                || !String.valueOf(totalChunks).equals(properties.getProperty("totalChunks"))) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
    }

    private void validateUploadId(String uploadId) {
        if (StringTools.isEmpty(uploadId) || !uploadId.matches("^[a-fA-F0-9]{32}$")) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
    }

    private void deleteFolder(File folder) {
        if (folder == null || !folder.exists()) {
            return;
        }
        File[] files = folder.listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.isDirectory()) {
                    deleteFolder(file);
                } else {
                    file.delete();
                }
            }
        }
        folder.delete();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void saveMessageFile(String userId, Long messageId, MultipartFile file, MultipartFile cover) {
        ChatMessage message = chatMessageMapper.selectByMessageId(messageId);
        if (null == message) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        if (!message.getSendUserId().equals(userId)) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        if (MessageStatusEnum.SENDED.getStatus().equals(message.getStatus())) {
            return;
        }

        SysSettingDto sysSettingDto = redisComponet.getSysSetting();
        String fileSuffix = StringTools.getFileSuffix(file.getOriginalFilename());
        if (!StringTools.isEmpty(fileSuffix) && ArraysUtil.contains(Constants.IMAGE_SUFFIX_LIST, fileSuffix.toLowerCase())
                && file.getSize() > Constants.FILE_SIZE_MB * sysSettingDto.getMaxImageSize()) {
            throw new BusinessException("图片大小超过限制");
        } else if (!StringTools.isEmpty(fileSuffix) && ArraysUtil.contains(Constants.VIDEO_SUFFIX_LIST, fileSuffix.toLowerCase())
                && file.getSize() > Constants.FILE_SIZE_MB * sysSettingDto.getMaxVideoSize()) {
            throw new BusinessException("视频大小超过限制");
        } else if (!StringTools.isEmpty(fileSuffix) &&
                !ArraysUtil.contains(Constants.VIDEO_SUFFIX_LIST, fileSuffix.toLowerCase()) &&
                !ArraysUtil.contains(Constants.IMAGE_SUFFIX_LIST, fileSuffix.toLowerCase()) &&
                file.getSize() > Constants.FILE_SIZE_MB * sysSettingDto.getMaxFileSize()) {
            throw new BusinessException("文件大小超过限制");
        }
        String fileName = file.getOriginalFilename();
        String fileExtName = StringTools.getFileSuffix(fileName);
        String fileRealName = messageId + fileExtName;
        String month = DateUtil.format(new Date(message.getSendTime()), DateTimePatternEnum.YYYYMM.getPattern());
        File folder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_FILE + month);
        if (!folder.exists()) {
            folder.mkdirs();
        }

        File uploadFile = new File(folder.getPath() + "/" + fileRealName);
        try {
            file.transferTo(uploadFile);
            if (cover != null) {
                cover.transferTo(new File(uploadFile.getPath() + Constants.COVER_IMAGE_SUFFIX));
            }
        } catch (Exception e) {
            logger.error("上传文件失败", e);
            throw new BusinessException("文件上传失败");
        }
        ChatMessage updateInfo = new ChatMessage();
        updateInfo.setStatus(MessageStatusEnum.SENDED.getStatus());
        ChatMessageQuery messageQuery = new ChatMessageQuery();
        messageQuery.setMessageId(messageId);
        chatMessageMapper.updateByParam(updateInfo, messageQuery);
        jdbcTemplate.update("update chat_message set upload_state='READY' where message_id=? and upload_state='PENDING'", messageId);

        publishMediaVisible(messageId);
    }

    @Override
    public Map<String, Object> initMessageFileUpload(String userId, Long messageId, String fileName, Long fileSize, Integer fileType, Integer totalChunks, Integer chunkSize, String fileFingerprint) {
        ChatMessage message = getSenderMessage(userId, messageId);
        SysSettingDto sysSettingDto = redisComponet.getSysSetting();
        String fileSuffix = getSafeFileSuffix(fileName);
        long size = fileSize == null ? 0L : fileSize;
        if (!StringTools.isEmpty(fileSuffix) && ArraysUtil.contains(Constants.IMAGE_SUFFIX_LIST, fileSuffix.toLowerCase())
                && size > Constants.FILE_SIZE_MB * sysSettingDto.getMaxImageSize()) {
            throw new BusinessException("图片大小超过限制");
        } else if (!StringTools.isEmpty(fileSuffix) && ArraysUtil.contains(Constants.VIDEO_SUFFIX_LIST, fileSuffix.toLowerCase())
                && size > Constants.FILE_SIZE_MB * sysSettingDto.getMaxVideoSize()) {
            throw new BusinessException("视频大小超过限制");
        } else if (!StringTools.isEmpty(fileSuffix) &&
                !ArraysUtil.contains(Constants.VIDEO_SUFFIX_LIST, fileSuffix.toLowerCase()) &&
                !ArraysUtil.contains(Constants.IMAGE_SUFFIX_LIST, fileSuffix.toLowerCase()) &&
                size > Constants.FILE_SIZE_MB * sysSettingDto.getMaxFileSize()) {
            throw new BusinessException("文件大小超过限制");
        }

        if (totalChunks == null || totalChunks <= 0 || chunkSize == null || chunkSize <= 0) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        int expectedChunks = (int) Math.ceil((double) size / chunkSize);
        if (expectedChunks != totalChunks) {
            throw new BusinessException("文件分片参数不一致");
        }
        String fingerprint = StringTools.isEmpty(fileFingerprint) ? "legacy" : fileFingerprint;
        String uploadId = StringTools.encodeByMD5(userId + "_" + messageId + "_" + fileName + "_" + fileSize + "_" + fingerprint);
        Properties terminalState = getUploadTerminalState(messageId);
        if (terminalState != null && "succeeded".equals(terminalState.getProperty("state"))) {
            Map<String, Object> completed = new HashMap<>();
            completed.put("uploadId", uploadId);
            completed.put("uploadedChunks", new java.util.ArrayList<>());
            completed.put("completed", true);
            return completed;
        }
        File tempFolder = getUploadTempFolder(message.getMessageId(), uploadId);
        File metaFile = getUploadMetaFile(tempFolder);
        if (!metaFile.exists()) {
            saveUploadMeta(tempFolder, uploadId, fileName, fileSize, totalChunks);
        } else {
            checkUploadMeta(messageId, uploadId, fileName, fileSize, totalChunks);
        }
        File[] chunkFiles = tempFolder.listFiles((dir, name) -> name.endsWith(".chunk"));
        List<Integer> uploadedChunks = new java.util.ArrayList<>();
        if (chunkFiles != null) {
            for (File item : chunkFiles) {
                try {
                    uploadedChunks.add(Integer.parseInt(item.getName().replace(".chunk", "")));
                } catch (Exception e) {
                    logger.warn("ignore invalid chunk file:{}", item.getName());
                }
            }
        }
        Map<String, Object> result = new HashMap<>();
        result.put("uploadId", uploadId);
        result.put("chunkSize", chunkSize == null || chunkSize <= 0 ? 4 * 1024 * 1024 : chunkSize);
        result.put("uploadedChunks", uploadedChunks);
        result.put("completed", getMessageFile(message, fileName).exists());
        return result;
    }

    @Override
    public void saveMessageFileChunk(String userId, Long messageId, String uploadId, Integer chunkIndex, Integer totalChunks, String chunkChecksum, MultipartFile chunk) {
        getSenderMessage(userId, messageId);
        if (StringTools.isEmpty(uploadId) || chunkIndex == null || chunkIndex < 0 || totalChunks == null || chunkIndex >= totalChunks || chunk == null) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        Properties uploadMeta = getUploadMeta(messageId, uploadId);
        checkUploadMeta(messageId, uploadId, uploadMeta.getProperty("fileName"), Long.valueOf(uploadMeta.getProperty("fileSize")), totalChunks);
        if (!StringTools.isEmpty(chunkChecksum)) {
            try {
                if (!DigestUtils.md5Hex(chunk.getBytes()).equalsIgnoreCase(chunkChecksum)) {
                    throw new BusinessException("文件分片校验失败");
                }
            } catch (BusinessException e) {
                throw e;
            } catch (Exception e) {
                throw new BusinessException("文件分片校验失败");
            }
        }
        File tempFolder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_TEMP + "upload/" + messageId + "/" + uploadId);
        File chunkFile = new File(tempFolder.getPath() + "/" + chunkIndex + ".chunk");
        if (chunkFile.exists() && chunkFile.length() == chunk.getSize()) {
            return;
        }
        try {
            chunk.transferTo(chunkFile);
        } catch (Exception e) {
            logger.error("上传分片失败", e);
            throw new BusinessException("上传分片失败");
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void completeMessageFileUpload(String userId, Long messageId, String uploadId, String fileName, Long fileSize, Integer fileType, Integer totalChunks, MultipartFile cover) {
        ChatMessage message = getSenderMessage(userId, messageId);
        if (StringTools.isEmpty(uploadId) || StringTools.isEmpty(fileName) || totalChunks == null || totalChunks <= 0) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        SysSettingDto sysSettingDto = redisComponet.getSysSetting();
        String fileSuffix = getSafeFileSuffix(fileName);
        long size = fileSize == null ? 0L : fileSize;
        if (!StringTools.isEmpty(fileSuffix) && ArraysUtil.contains(Constants.IMAGE_SUFFIX_LIST, fileSuffix.toLowerCase())
                && size > Constants.FILE_SIZE_MB * sysSettingDto.getMaxImageSize()) {
            throw new BusinessException("图片大小超过限制");
        } else if (!StringTools.isEmpty(fileSuffix) && ArraysUtil.contains(Constants.VIDEO_SUFFIX_LIST, fileSuffix.toLowerCase())
                && size > Constants.FILE_SIZE_MB * sysSettingDto.getMaxVideoSize()) {
            throw new BusinessException("视频大小超过限制");
        } else if (!StringTools.isEmpty(fileSuffix) &&
                !ArraysUtil.contains(Constants.VIDEO_SUFFIX_LIST, fileSuffix.toLowerCase()) &&
                !ArraysUtil.contains(Constants.IMAGE_SUFFIX_LIST, fileSuffix.toLowerCase()) &&
                size > Constants.FILE_SIZE_MB * sysSettingDto.getMaxFileSize()) {
            throw new BusinessException("文件大小超过限制");
        }

        RLock completeLock = redissonClient.getLock("easychat:upload:terminal:" + messageId);
        completeLock.lock();
        try {
        try {
            claimUploadFinalization(messageId);
        } catch (UploadAlreadyFinalizedException ignored) {
            return;
        }
        Properties terminalState = getUploadTerminalState(messageId);
        if (terminalState != null && "succeeded".equals(terminalState.getProperty("state"))) {
            finishUploadFinalization(messageId, "READY");
            return;
        }
        checkUploadMeta(messageId, uploadId, fileName, fileSize, totalChunks);
        File tempFolder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_TEMP + "upload/" + messageId + "/" + uploadId);
        File targetFile = getMessageFile(message, fileName);
        File assemblingFile = new File(targetFile.getPath() + ".assembling." + uploadId);
        try (FileOutputStream outputStream = new FileOutputStream(assemblingFile)) {
            byte[] buffer = new byte[8192];
            for (int index = 0; index < totalChunks; index++) {
                File chunkFile = new File(tempFolder.getPath() + "/" + index + ".chunk");
                if (!chunkFile.exists()) {
                    throw new BusinessException("文件分片不完整");
                }
                try (FileInputStream inputStream = new FileInputStream(chunkFile)) {
                    int len;
                    while ((len = inputStream.read(buffer)) != -1) {
                        outputStream.write(buffer, 0, len);
                    }
                }
            }
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            logger.error("合并分片失败", e);
            throw new BusinessException("合并分片失败");
        }
        if (fileSize != null && assemblingFile.length() != fileSize) {
            assemblingFile.delete();
            throw new BusinessException("文件大小校验失败");
        }
        try {
            Files.move(assemblingFile.toPath(), targetFile.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception e) {
            try {
                Files.move(assemblingFile.toPath(), targetFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
            } catch (Exception moveError) {
                logger.error("原子移动上传文件失败", moveError);
                throw new BusinessException("合并分片失败");
            }
        }
        try {
            if (cover != null) {
                cover.transferTo(new File(targetFile.getPath() + Constants.COVER_IMAGE_SUFFIX));
            }
        } catch (Exception e) {
            logger.error("保存封面失败", e);
            throw new BusinessException("保存封面失败");
        }
        deleteFolder(tempFolder);

        ChatMessage updateInfo = new ChatMessage();
        updateInfo.setStatus(MessageStatusEnum.SENDED.getStatus());
        updateInfo.setFileName(fileName);
        updateInfo.setFileSize(fileSize);
        updateInfo.setFileType(fileType);
        ChatMessageQuery messageQuery = new ChatMessageQuery();
        messageQuery.setMessageId(messageId);
        chatMessageMapper.updateByParam(updateInfo, messageQuery);
        finishUploadFinalization(messageId, "READY");
        saveUploadTerminalState(messageId, "succeeded", uploadId);

        publishMediaVisible(messageId);
        } finally {
            if (completeLock.isHeldByCurrentThread()) completeLock.unlock();
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void cancelMessageFileUpload(String userId, Long messageId, String uploadId) {
        ChatMessage message = getSenderMessage(userId, messageId);
        RLock completeLock = redissonClient.getLock("easychat:upload:terminal:" + messageId);
        completeLock.lock();
        try {
        try {
            claimUploadFinalization(messageId);
        } catch (UploadAlreadyFinalizedException ignored) {
            return;
        }
        Properties terminalState = getUploadTerminalState(messageId);
        if (terminalState != null && "succeeded".equals(terminalState.getProperty("state"))) {
            finishUploadFinalization(messageId, "READY");
            return;
        }
        if (!StringTools.isEmpty(uploadId)) {
            validateUploadId(uploadId);
            deleteFolder(new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_TEMP + "upload/" + messageId + "/" + uploadId));
        } else {
            File folder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_TEMP + "upload/" + messageId);
            deleteFolder(folder);
        }
        saveUploadTerminalState(messageId, "failed", uploadId);
        ChatMessage updateInfo = new ChatMessage();
        updateInfo.setStatus(MessageStatusEnum.SENDING.getStatus());
        ChatMessageQuery messageQuery = new ChatMessageQuery();
        messageQuery.setMessageId(messageId);
        chatMessageMapper.updateByParam(updateInfo, messageQuery);
        finishUploadFinalization(messageId, "FAILED");
        publishMediaTerminalState(message, MessageStatusEnum.SENDING.getStatus());
        } finally {
            if (completeLock.isHeldByCurrentThread()) completeLock.unlock();
        }
    }

    @Override
    public Map<String, Object> getMessageFileUploadStatus(String userId, Long messageId, String uploadId) {
        ChatMessage message = getSenderMessage(userId, messageId);
        Properties terminalState = getUploadTerminalState(messageId);
        Map<String, Object> result = new HashMap<>();
        if (terminalState != null) {
            boolean succeeded = "succeeded".equals(terminalState.getProperty("state"));
            result.put("messageStatus", succeeded ? MessageStatusEnum.SENDED.getStatus() : MessageStatusEnum.SENDING.getStatus());
            result.put("terminal", true);
            result.put("failed", !succeeded);
            result.put("uploadId", terminalState.getProperty("uploadId"));
            result.put("uploadedChunks", new java.util.ArrayList<>());
            result.put("completed", succeeded);
            return result;
        }
        if (StringTools.isEmpty(uploadId)) {
            result.put("messageStatus", message.getStatus());
            result.put("terminal", MessageStatusEnum.SENDED.getStatus().equals(message.getStatus()));
            result.put("failed", false);
            result.put("uploadedChunks", new java.util.ArrayList<>());
            result.put("completed", MessageStatusEnum.SENDED.getStatus().equals(message.getStatus()));
            return result;
        }
        Properties properties = getUploadMeta(messageId, uploadId);
        File folder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_TEMP + "upload/" + messageId + "/" + uploadId);
        File[] chunks = folder.listFiles((dir, name) -> name.endsWith(".chunk"));
        List<Integer> uploadedChunks = new java.util.ArrayList<>();
        if (chunks != null) {
            for (File chunk : chunks) {
                try {
                    uploadedChunks.add(Integer.parseInt(chunk.getName().replace(".chunk", "")));
                } catch (Exception e) {
                    logger.warn("ignore invalid chunk file:{}", chunk.getName());
                }
            }
        }
        result.put("uploadId", uploadId);
        result.put("fileName", properties.getProperty("fileName"));
        result.put("fileSize", properties.getProperty("fileSize"));
        result.put("totalChunks", properties.getProperty("totalChunks"));
        result.put("uploadedChunks", uploadedChunks);
        result.put("completed", getMessageFile(message, properties.getProperty("fileName")).exists());
        result.put("messageStatus", message.getStatus());
        result.put("terminal", false);
        result.put("failed", false);
        return result;
    }

    @Override
    public File downloadFile(TokenUserInfoDto userInfoDto, Long messageId, Boolean cover) {
        ChatMessage message = chatMessageMapper.selectByMessageId(messageId);
        String contactId = message.getContactId();
        UserContactTypeEnum contactTypeEnum = UserContactTypeEnum.getByPrefix(contactId);
        if (UserContactTypeEnum.USER.getType().equals(contactTypeEnum)
                && !userInfoDto.getUserId().equals(message.getContactId())
                && !userInfoDto.getUserId().equals(message.getSendUserId())) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        if (UserContactTypeEnum.GROUP.getType().equals(contactTypeEnum)) {
            UserContactQuery userContactQuery = new UserContactQuery();
            userContactQuery.setUserId(userInfoDto.getUserId());
            userContactQuery.setContactType(UserContactTypeEnum.GROUP.getType());
            userContactQuery.setContactId(contactId);
            userContactQuery.setStatus(UserContactStatusEnum.FRIEND.getStatus());
            Integer contactCount = userContactMapper.selectCount(userContactQuery);
            if (contactCount == 0) {
                throw new BusinessException(ResponseCodeEnum.CODE_600);
            }
        }
        String month = DateUtil.format(new Date(message.getSendTime()), DateTimePatternEnum.YYYYMM.getPattern());
        File folder = new File(appConfig.getProjectFolder() + Constants.FILE_FOLDER_FILE + month);
        if (!folder.exists()) {
            folder.mkdirs();
        }
        String fileName = message.getFileName();
        String fileExtName = StringTools.getFileSuffix(fileName);
        String fileRealName = messageId + fileExtName;

        if (cover != null && cover) {
            fileRealName = fileRealName + Constants.COVER_IMAGE_SUFFIX;
        }
        File file = new File(folder.getPath() + "/" + fileRealName);
        if (!file.exists()) {
            logger.info("文件不存在");
            throw new BusinessException(ResponseCodeEnum.CODE_602);
        }
        return file;
    }
}
