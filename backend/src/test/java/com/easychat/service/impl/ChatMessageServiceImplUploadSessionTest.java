package com.easychat.service.impl;

import com.easychat.entity.config.AppConfig;
import com.easychat.entity.dto.SysSettingDto;
import com.easychat.entity.po.ChatMessage;
import com.easychat.exception.BusinessException;
import com.easychat.mappers.ChatMessageMapper;
import com.easychat.redis.RedisComponet;
import com.easychat.entity.query.ChatMessageQuery;
import org.apache.commons.codec.digest.DigestUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Path;
import java.util.Collections;
import java.util.Map;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ChatMessageServiceImplUploadSessionTest {

    private static final String USER_ID = "u-test";
    private static final Long MESSAGE_ID = 100L;

    @TempDir
    Path projectFolder;

    private ChatMessageServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new ChatMessageServiceImpl();
        ChatMessageMapper<ChatMessage, ChatMessageQuery> mapper = mock(ChatMessageMapper.class);
        ChatMessage message = new ChatMessage();
        message.setMessageId(MESSAGE_ID);
        message.setSendUserId(USER_ID);
        message.setSendTime(System.currentTimeMillis());
        when(mapper.selectByMessageId(MESSAGE_ID)).thenReturn(message);

        AppConfig appConfig = new AppConfig();
        ReflectionTestUtils.setField(appConfig, "projectFolder", projectFolder.toString());
        RedisComponet redisComponet = mock(RedisComponet.class);
        when(redisComponet.getSysSetting()).thenReturn(new SysSettingDto());
        ReflectionTestUtils.setField(service, "chatMessageMapper", mapper);
        ReflectionTestUtils.setField(service, "appConfig", appConfig);
        ReflectionTestUtils.setField(service, "redisComponet", redisComponet);
    }

    @Test
    void acceptsOnlyMd5UploadSessionIds() throws Exception {
        Method validateUploadId = ChatMessageServiceImpl.class.getDeclaredMethod("validateUploadId", String.class);
        validateUploadId.setAccessible(true);

        assertDoesNotThrow(() -> validateUploadId.invoke(service, "0123456789abcdef0123456789abcdef"));
        assertThrows(InvocationTargetException.class,
                () -> validateUploadId.invoke(service, "../../outside-session"));
    }

    @Test
    void persistsSessionAndReportsOnlyAcknowledgedChunks() {
        Map<String, Object> init = service.initMessageFileUpload(
                USER_ID, MESSAGE_ID, "upload.bin", 4L, 2, 2, 2, "client-task"
        );
        String uploadId = (String) init.get("uploadId");
        byte[] content = new byte[]{1, 2};
        MockMultipartFile chunk = new MockMultipartFile("chunk", "0.chunk", "application/octet-stream", content);

        assertThrows(BusinessException.class, () -> service.saveMessageFileChunk(
                USER_ID, MESSAGE_ID, uploadId, 0, 2, "not-a-checksum", chunk
        ));
        assertDoesNotThrow(() -> service.saveMessageFileChunk(
                USER_ID, MESSAGE_ID, uploadId, 0, 2, DigestUtils.md5Hex(content), chunk
        ));
        assertDoesNotThrow(() -> service.saveMessageFileChunk(
                USER_ID, MESSAGE_ID, uploadId, 0, 2, DigestUtils.md5Hex(content), chunk
        ));

        Map<String, Object> status = service.getMessageFileUploadStatus(USER_ID, MESSAGE_ID, uploadId);
        assertEquals(Collections.singletonList(0), status.get("uploadedChunks"));
        assertEquals(false, status.get("terminal"));
    }

    @Test
    void rejectsCompleteWhenAChunkIsMissingAndIgnoresAlreadyFinalizedOperations() {
        Map<String, Object> init = service.initMessageFileUpload(
                USER_ID, MESSAGE_ID, "upload.bin", 4L, 2, 2, 2, "client-task"
        );
        String uploadId = (String) init.get("uploadId");
        byte[] content = new byte[]{1, 2};
        MockMultipartFile chunk = new MockMultipartFile("chunk", "0.chunk", "application/octet-stream", content);
        service.saveMessageFileChunk(USER_ID, MESSAGE_ID, uploadId, 0, 2, DigestUtils.md5Hex(content), chunk);

        RLock lock = mock(RLock.class);
        RedissonClient redissonClient = mock(RedissonClient.class);
        when(redissonClient.getLock(anyString())).thenReturn(lock);
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.update(anyString(), any(Object[].class))).thenReturn(1);
        ReflectionTestUtils.setField(service, "redissonClient", redissonClient);
        ReflectionTestUtils.setField(service, "jdbcTemplate", jdbcTemplate);

        assertThrows(BusinessException.class, () -> service.completeMessageFileUpload(
                USER_ID, MESSAGE_ID, uploadId, "upload.bin", 4L, 2, 2, null
        ));

        when(jdbcTemplate.update(anyString(), any(Object[].class))).thenReturn(0);
        when(jdbcTemplate.queryForObject(anyString(), eq(String.class), eq(MESSAGE_ID))).thenReturn("READY");
        assertDoesNotThrow(() -> service.completeMessageFileUpload(
                USER_ID, MESSAGE_ID, uploadId, "upload.bin", 4L, 2, 2, null
        ));
        assertDoesNotThrow(() -> service.cancelMessageFileUpload(USER_ID, MESSAGE_ID, uploadId));
    }
}
