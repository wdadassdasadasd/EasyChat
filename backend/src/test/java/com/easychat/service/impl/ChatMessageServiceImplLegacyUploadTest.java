package com.easychat.service.impl;

import com.easychat.entity.config.AppConfig;
import com.easychat.entity.dto.SysSettingDto;
import com.easychat.entity.po.ChatMessage;
import com.easychat.entity.query.ChatMessageQuery;
import com.easychat.exception.BusinessException;
import com.easychat.mappers.ChatMessageMapper;
import com.easychat.redis.RedisComponet;
import com.easychat.service.ChatEventOutboxService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ChatMessageServiceImplLegacyUploadTest {
    private static final long MESSAGE_ID = 77L;
    private static final String USER_ID = "U1001";

    @TempDir
    Path projectFolder;

    private ChatMessageServiceImpl service;
    private ChatMessage message;

    @BeforeEach
    void setUp() {
        service = new ChatMessageServiceImpl();
        message = new ChatMessage();
        message.setMessageId(MESSAGE_ID);
        message.setSendUserId(USER_ID);
        message.setContactId("U2002");
        message.setSendTime(System.currentTimeMillis());

        ChatMessageMapper<ChatMessage, ChatMessageQuery> mapper = mock(ChatMessageMapper.class);
        when(mapper.selectByMessageId(MESSAGE_ID)).thenReturn(message);
        RedisComponet redis = mock(RedisComponet.class);
        when(redis.getSysSetting()).thenReturn(new SysSettingDto());
        AppConfig appConfig = new AppConfig();
        ReflectionTestUtils.setField(appConfig, "projectFolder", projectFolder.toString());
        ReflectionTestUtils.setField(service, "chatMessageMapper", mapper);
        ReflectionTestUtils.setField(service, "redisComponet", redis);
        ReflectionTestUtils.setField(service, "appConfig", appConfig);
        ReflectionTestUtils.setField(service, "jdbcTemplate", mock(JdbcTemplate.class));
        ReflectionTestUtils.setField(service, "chatEventOutboxService", mock(ChatEventOutboxService.class));
    }

    @Test
    void storesAndDownloadsExtensionlessFilesWithoutSubstringFailures() throws Exception {
        message.setFileName("LICENSE");
        MockMultipartFile file = new MockMultipartFile(
                "file", "LICENSE", "application/octet-stream", new byte[]{1, 2, 3});

        service.saveMessageFile(USER_ID, MESSAGE_ID, file, null);

        assertTrue(Files.walk(projectFolder).anyMatch(path -> path.getFileName().toString().equals("77")));
    }

    @Test
    void rejectsLegacyUploadsWhoseMultipartNameDiffersFromTheMessageMetadata() {
        message.setFileName("photo.jpg");
        MockMultipartFile file = new MockMultipartFile(
                "file", "photo.png", "image/png", new byte[]{1, 2, 3});

        assertThrows(BusinessException.class,
                () -> service.saveMessageFile(USER_ID, MESSAGE_ID, file, null));
    }
}
