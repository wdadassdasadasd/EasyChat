package com.easychat.controller;

import com.easychat.annotation.GlobalInterceptor;
import com.easychat.entity.config.AppConfig;
import com.easychat.entity.constants.Constants;
import com.easychat.entity.dto.FileDownloadTokenDto;
import com.easychat.entity.dto.MessageSendDto;
import com.easychat.entity.dto.TokenUserInfoDto;
import com.easychat.entity.enums.MessageTypeEnum;
import com.easychat.entity.enums.ResponseCodeEnum;
import com.easychat.entity.po.ChatMessage;
import com.easychat.entity.vo.ResponseVO;
import com.easychat.exception.BusinessException;
import com.easychat.redis.RedisUtils;
import com.easychat.service.ChatMessageService;
import com.easychat.service.ChatEventOutboxService;
import com.easychat.service.ChatSessionUserService;
import com.easychat.utils.StringTools;
import org.apache.commons.lang3.ArrayUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.URLEncoder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * @ClassName ChatController
 * @Description TODO
 * @Author 程序员老罗 https://space.bilibili.com/499388891
 * @Date 2023/12/17 21:50
 */
@RestController
@RequestMapping("/chat")
public class ChatController extends ABaseController {

    private static final Logger logger = LoggerFactory.getLogger(ChatController.class);
    private static final Pattern AVATAR_FILE_ID_PATTERN = Pattern.compile("^[UG][0-9]{1,11}$");

    @Resource
    private ChatMessageService chatMessageService;

    @Resource
    private ChatEventOutboxService chatEventOutboxService;

    @Resource
    private ChatSessionUserService chatSessionUserService;

    @Resource
    private AppConfig appConfig;

    @Resource
    private RedisUtils redisUtils;


    @RequestMapping("/sendMessage")
    @GlobalInterceptor
    public ResponseVO sendMessage(HttpServletRequest request,
                                  @NotEmpty String contactId,
                                  @NotEmpty @Size(max = 500) String messageContent,
                                  @NotNull Integer messageType,
                                  @NotEmpty @Size(min = 36, max = 36) String clientMessageId,
                                  Long fileSize,
                                  String fileName,
                                  Integer fileType) {
        MessageTypeEnum messageTypeEnum = MessageTypeEnum.getByType(messageType);
        if (null == messageTypeEnum || !ArrayUtils.contains(new Integer[]{MessageTypeEnum.CHAT.getType(), MessageTypeEnum.MEDIA_CHAT.getType()}, messageType)) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        TokenUserInfoDto tokenUserInfoDto = getTokenUserInfo(request);
        ChatMessage chatMessage = new ChatMessage();
        chatMessage.setClientMessageId(clientMessageId);
        chatMessage.setContactId(contactId);
        chatMessage.setMessageContent(messageContent);
        chatMessage.setFileSize(fileSize);
        chatMessage.setFileName(fileName);
        chatMessage.setFileType(fileType);
        chatMessage.setMessageType(messageType);
        MessageSendDto messageSendDto = chatMessageService.saveMessage(chatMessage, tokenUserInfoDto);
        return getSuccessResponseVO(messageSendDto);
    }

    @RequestMapping("/syncEvents")
    @GlobalInterceptor
    public ResponseVO syncEvents(HttpServletRequest request, Long cursor, Integer limit) {
        TokenUserInfoDto tokenUserInfoDto = getTokenUserInfo(request);
        return getSuccessResponseVO(chatEventOutboxService.syncEvents(
                tokenUserInfoDto.getUserId(), Math.max(0L, cursor == null ? 0L : cursor),
                limit == null ? 200 : limit));
    }

    @RequestMapping("/syncSnapshot")
    @GlobalInterceptor
    public ResponseVO syncSnapshot(HttpServletRequest request, Long snapshotCursor, String sessionCursor) {
        TokenUserInfoDto tokenUserInfoDto = getTokenUserInfo(request);
        return getSuccessResponseVO(chatEventOutboxService.syncSnapshot(tokenUserInfoDto.getUserId(), snapshotCursor, sessionCursor));
    }

    @RequestMapping("/markRead")
    @GlobalInterceptor
    public ResponseVO markRead(HttpServletRequest request, @NotEmpty String contactId,
                               @NotEmpty @Size(min = 36, max = 64) String readRequestId) {
        TokenUserInfoDto tokenUserInfoDto = getTokenUserInfo(request);
        chatEventOutboxService.markRead(tokenUserInfoDto.getUserId(), contactId, readRequestId);
        return getSuccessResponseVO(null);
    }

    @RequestMapping("uploadFile")
    @GlobalInterceptor
    public ResponseVO uploadFile(HttpServletRequest request,
                                 @NotNull Long messageId,
                                 @NotNull MultipartFile file,
                                 @RequestParam(value = "cover", required = false) MultipartFile cover) {
        TokenUserInfoDto userInfoDto = getTokenUserInfo(request);
        chatMessageService.saveMessageFile(userInfoDto.getUserId(), messageId, file, cover != null && !cover.isEmpty() ? cover : null);
        return getSuccessResponseVO(null);
    }

    @RequestMapping("uploadFile/init")
    @GlobalInterceptor
    public ResponseVO initUploadFile(HttpServletRequest request,
                                     @NotNull Long messageId,
                                     @NotEmpty String fileName,
                                     @NotNull Long fileSize,
                                     Integer fileType,
                                     @NotNull Integer totalChunks,
                                     Integer chunkSize,
                                     String fileFingerprint) {
        TokenUserInfoDto userInfoDto = getTokenUserInfo(request);
        return getSuccessResponseVO(chatMessageService.initMessageFileUpload(userInfoDto.getUserId(), messageId, fileName, fileSize, fileType, totalChunks, chunkSize, fileFingerprint));
    }

    @RequestMapping("uploadFile/chunk")
    @GlobalInterceptor
    public ResponseVO uploadFileChunk(HttpServletRequest request,
                                      @NotEmpty String uploadId,
                                      @NotNull Long messageId,
                                      @NotNull Integer chunkIndex,
                                      @NotNull Integer totalChunks,
                                      String chunkChecksum,
                                      @NotNull MultipartFile chunk) {
        TokenUserInfoDto userInfoDto = getTokenUserInfo(request);
        chatMessageService.saveMessageFileChunk(userInfoDto.getUserId(), messageId, uploadId, chunkIndex, totalChunks, chunkChecksum, chunk);
        return getSuccessResponseVO(null);
    }

    @RequestMapping("uploadFile/complete")
    @GlobalInterceptor
    public ResponseVO completeUploadFile(HttpServletRequest request,
                                         @NotEmpty String uploadId,
                                         @NotNull Long messageId,
                                         @NotEmpty String fileName,
                                         @NotNull Long fileSize,
                                         Integer fileType,
                                         @NotNull Integer totalChunks,
                                         MultipartFile cover) {
        TokenUserInfoDto userInfoDto = getTokenUserInfo(request);
        chatMessageService.completeMessageFileUpload(userInfoDto.getUserId(), messageId, uploadId, fileName, fileSize, fileType, totalChunks, cover);
        return getSuccessResponseVO(null);
    }

    @RequestMapping("uploadFile/cancel")
    @GlobalInterceptor
    public ResponseVO cancelUploadFile(HttpServletRequest request,
                                       @NotNull Long messageId,
                                       String uploadId) {
        TokenUserInfoDto userInfoDto = getTokenUserInfo(request);
        chatMessageService.cancelMessageFileUpload(userInfoDto.getUserId(), messageId, uploadId);
        return getSuccessResponseVO(null);
    }

    @RequestMapping("uploadFile/status")
    @GlobalInterceptor
    public ResponseVO getUploadFileStatus(HttpServletRequest request,
                                          @NotNull Long messageId,
                                          String uploadId) {
        TokenUserInfoDto userInfoDto = getTokenUserInfo(request);
        return getSuccessResponseVO(chatMessageService.getMessageFileUploadStatus(userInfoDto.getUserId(), messageId, uploadId));
    }

    @RequestMapping("createDownloadToken")
    @GlobalInterceptor
    public ResponseVO createDownloadToken(HttpServletRequest request,
                                          @NotEmpty String fileId,
                                          @NotNull Boolean showCover,
                                          Boolean download) {
        if (!StringTools.isNumber(fileId)) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        TokenUserInfoDto userInfoDto = getTokenUserInfo(request);
        chatMessageService.downloadFile(userInfoDto, Long.parseLong(fileId), showCover);
        String token = UUID.randomUUID().toString().replace("-", "");
        FileDownloadTokenDto tokenDto = new FileDownloadTokenDto();
        tokenDto.setUserId(userInfoDto.getUserId());
        tokenDto.setMessageId(Long.parseLong(fileId));
        tokenDto.setShowCover(showCover);
        tokenDto.setDownload(download);
        redisUtils.setex(Constants.REDIS_KEY_DOWNLOAD_TOKEN + token, tokenDto, Constants.REDIS_KEY_EXPIRES_DOWNLOAD_TOKEN);

        Map<String, Object> result = new HashMap<>();
        result.put("downloadToken", token);
        result.put("streamUrl", "/chat/streamFile?fileId=" + fileId + "&showCover=" + showCover + "&downloadToken=" + token + "&download=" + Boolean.TRUE.equals(download));
        return getSuccessResponseVO(result);
    }

    @RequestMapping("streamFile")
    public void streamFile(HttpServletResponse response,
                           String fileId,
                           Boolean showCover,
                           String downloadToken,
                           Boolean download,
                           HttpServletRequest request) throws Exception {
        FileDownloadTokenDto tokenDto = (FileDownloadTokenDto) redisUtils.get(Constants.REDIS_KEY_DOWNLOAD_TOKEN + downloadToken);
        if (tokenDto == null || !StringTools.isNumber(fileId) || !tokenDto.getMessageId().equals(Long.parseLong(fileId))) {
            throw new BusinessException(ResponseCodeEnum.CODE_901);
        }
        TokenUserInfoDto userInfoDto = new TokenUserInfoDto();
        userInfoDto.setUserId(tokenDto.getUserId());
        File file = chatMessageService.downloadFile(userInfoDto, Long.parseLong(fileId), tokenDto.getShowCover());
        writeFileWithRange(request, response, file, Boolean.TRUE.equals(download) || Boolean.TRUE.equals(tokenDto.getDownload()), Boolean.TRUE.equals(tokenDto.getShowCover()));
    }

    private String getMimeType(File file, Boolean cover) {
        if (Boolean.TRUE.equals(cover)) {
            return "image/png";
        }
        String fileName = file.getName().toLowerCase();
        if (fileName.endsWith(".mp4") || fileName.endsWith(".m4v")) {
            return "video/mp4";
        }
        if (fileName.endsWith(".mov")) {
            return "video/quicktime";
        }
        if (fileName.endsWith(".webm")) {
            return "video/webm";
        }
        if (fileName.endsWith(".mkv")) {
            return "video/x-matroska";
        }
        if (fileName.endsWith(".avi")) {
            return "video/x-msvideo";
        }
        if (fileName.endsWith(".flv")) {
            return "video/x-flv";
        }
        if (fileName.endsWith(".wmv")) {
            return "video/x-ms-wmv";
        }
        if (fileName.endsWith(".ogg") || fileName.endsWith(".ogv")) {
            return "video/ogg";
        }
        if (fileName.endsWith(".3gp")) {
            return "video/3gpp";
        }
        if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (fileName.endsWith(".png")) {
            return "image/png";
        }
        if (fileName.endsWith(".gif")) {
            return "image/gif";
        }
        return "application/octet-stream";
    }

    private void writeFileWithRange(HttpServletRequest request, HttpServletResponse response, File file, Boolean download, Boolean cover) throws Exception {
        long fileLength = file.length();
        long start = 0;
        long end = fileLength - 1;
        boolean partial = false;
        String range = request.getHeader("Range");
        if (!StringTools.isEmpty(range) && range.startsWith("bytes=")) {
            partial = true;
            String[] ranges = range.substring(6).split("-", 2);
            if (!StringTools.isEmpty(ranges[0])) {
                start = Long.parseLong(ranges[0]);
            }
            if (ranges.length > 1 && !StringTools.isEmpty(ranges[1])) {
                end = Long.parseLong(ranges[1]);
            }
            if (start < 0 || end >= fileLength || start > end) {
                response.setStatus(HttpServletResponse.SC_REQUESTED_RANGE_NOT_SATISFIABLE);
                response.setHeader("Content-Range", "bytes */" + fileLength);
                return;
            }
        }
        long contentLength = end - start + 1;
        response.setStatus(partial ? HttpServletResponse.SC_PARTIAL_CONTENT : HttpServletResponse.SC_OK);
        response.setContentType(getMimeType(file, cover));
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Content-Length", String.valueOf(contentLength));
        if (partial) {
            response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + fileLength);
        }
        String dispositionType = Boolean.TRUE.equals(download) ? "attachment" : "inline";
        response.setHeader("Content-Disposition", dispositionType + "; filename=\"" + URLEncoder.encode(file.getName(), "UTF-8") + "\"");

        byte[] buffer = new byte[8192];
        try (RandomAccessFile randomAccessFile = new RandomAccessFile(file, "r");
             OutputStream outputStream = response.getOutputStream()) {
            randomAccessFile.seek(start);
            long remaining = contentLength;
            while (remaining > 0) {
                int read = randomAccessFile.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (read == -1) {
                    break;
                }
                outputStream.write(buffer, 0, read);
                remaining -= read;
            }
            outputStream.flush();
        }
    }

    @RequestMapping("downloadFile")
    @GlobalInterceptor
    public void downloadFile(HttpServletRequest request, HttpServletResponse response,
                             @NotEmpty String fileId,
                             @NotNull Boolean showCover) throws Exception {
        TokenUserInfoDto userInfoDto = getTokenUserInfo(request);
        OutputStream out = null;
        FileInputStream in = null;
        try {
            File file = null;
            if (!StringTools.isNumber(fileId)) {
                file = resolveAvatarFile(fileId, showCover);
            } else {
                file = chatMessageService.downloadFile(userInfoDto, Long.parseLong(fileId), showCover);
            }
            response.setContentType("application/x-msdownload; charset=UTF-8");
            response.setHeader("Content-Disposition", "attachment;");
            response.setContentLengthLong(file.length());
            in = new FileInputStream(file);
            byte[] byteData = new byte[1024];
            out = response.getOutputStream();
            int len = 0;
            while ((len = in.read(byteData)) != -1) {
                out.write(byteData, 0, len);
            }
            out.flush();
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (IOException e) {
                    logger.error("IO异常", e);
                }
            }
            if (in != null) {
                try {
                    in.close();
                } catch (IOException e) {
                    logger.error("IO异常", e);
                }
            }
        }
    }

    private File resolveAvatarFile(String fileId, Boolean showCover) throws IOException {
        if (!AVATAR_FILE_ID_PATTERN.matcher(fileId).matches() && !Constants.ROBOT_UID.equals(fileId)) {
            throw new BusinessException(ResponseCodeEnum.CODE_602);
        }
        Path avatarRoot = Paths.get(appConfig.getProjectFolder() + Constants.FILE_FOLDER_FILE + Constants.FILE_FOLDER_AVATAR_NAME)
                .toAbsolutePath().normalize();
        String suffix = Constants.IMAGE_SUFFIX + (Boolean.TRUE.equals(showCover) ? Constants.COVER_IMAGE_SUFFIX : "");
        Path avatarPath = avatarRoot.resolve(fileId + suffix).normalize();
        if (!avatarPath.startsWith(avatarRoot) || !Files.isRegularFile(avatarPath)) {
            throw new BusinessException(ResponseCodeEnum.CODE_602);
        }
        Path realAvatarRoot = avatarRoot.toRealPath();
        Path realAvatarPath = avatarPath.toRealPath();
        if (!realAvatarPath.startsWith(realAvatarRoot)) {
            throw new BusinessException(ResponseCodeEnum.CODE_602);
        }
        return realAvatarPath.toFile();
    }
}
