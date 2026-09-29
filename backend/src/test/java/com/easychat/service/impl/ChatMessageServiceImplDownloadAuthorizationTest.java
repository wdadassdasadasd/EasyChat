package com.easychat.service.impl;

import com.easychat.entity.config.AppConfig;
import com.easychat.entity.dto.TokenUserInfoDto;
import com.easychat.entity.enums.DateTimePatternEnum;
import com.easychat.entity.po.ChatMessage;
import com.easychat.entity.po.UserContact;
import com.easychat.entity.query.ChatMessageQuery;
import com.easychat.entity.query.UserContactQuery;
import com.easychat.exception.BusinessException;
import com.easychat.mappers.ChatMessageMapper;
import com.easychat.mappers.UserContactMapper;
import com.easychat.utils.DateUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ChatMessageServiceImplDownloadAuthorizationTest {

    private static final long MESSAGE_ID = 42L;

    @TempDir
    Path projectFolder;

    private ChatMessageServiceImpl service;
    private ChatMessageMapper<ChatMessage, ChatMessageQuery> messageMapper;
    private UserContactMapper<UserContact, UserContactQuery> contactMapper;

    @BeforeEach
    void setUp() {
        service = new ChatMessageServiceImpl();
        messageMapper = mock(ChatMessageMapper.class);
        contactMapper = mock(UserContactMapper.class);
        AppConfig appConfig = new AppConfig();
        ReflectionTestUtils.setField(appConfig, "projectFolder", projectFolder.toString());
        ReflectionTestUtils.setField(service, "chatMessageMapper", messageMapper);
        ReflectionTestUtils.setField(service, "userContactMapper", contactMapper);
        ReflectionTestUtils.setField(service, "appConfig", appConfig);
    }

    @Test
    void allowsOnlySenderAndRecipientForDirectMessages() throws Exception {
        ChatMessage message = directMessage();
        when(messageMapper.selectByMessageId(MESSAGE_ID)).thenReturn(message);
        File expected = createMessageFile(message);

        assertEquals(expected.getCanonicalFile(), service.downloadFile(user("U1001"), MESSAGE_ID, false).getCanonicalFile());
        assertEquals(expected.getCanonicalFile(), service.downloadFile(user("U2002"), MESSAGE_ID, false).getCanonicalFile());
        assertThrows(BusinessException.class, () -> service.downloadFile(user("U3003"), MESSAGE_ID, false));
    }

    @Test
    void requiresActiveMembershipForGroupMessages() throws Exception {
        ChatMessage message = message("G2002");
        when(messageMapper.selectByMessageId(MESSAGE_ID)).thenReturn(message);
        File expected = createMessageFile(message);
        when(contactMapper.selectCount(any(UserContactQuery.class))).thenReturn(1);

        assertEquals(expected.getCanonicalFile(), service.downloadFile(user("U1001"), MESSAGE_ID, false).getCanonicalFile());

        when(contactMapper.selectCount(any(UserContactQuery.class))).thenReturn(0);
        assertThrows(BusinessException.class, () -> service.downloadFile(user("U1001"), MESSAGE_ID, false));
    }

    @Test
    void failsClosedForMissingMessagesAndUnknownContactTypes() {
        when(messageMapper.selectByMessageId(MESSAGE_ID)).thenReturn(null);
        assertThrows(BusinessException.class, () -> service.downloadFile(user("U1001"), MESSAGE_ID, false));

        when(messageMapper.selectByMessageId(MESSAGE_ID)).thenReturn(message("X2002"));
        assertThrows(BusinessException.class, () -> service.downloadFile(user("U1001"), MESSAGE_ID, false));
    }

    @Test
    void downloadsExtensionlessFiles() throws Exception {
        ChatMessage message = directMessage();
        message.setFileName("LICENSE");
        when(messageMapper.selectByMessageId(MESSAGE_ID)).thenReturn(message);
        String month = DateUtil.format(new Date(message.getSendTime()), DateTimePatternEnum.YYYYMM.getPattern());
        Path expected = projectFolder.resolve("file").resolve(month).resolve(String.valueOf(MESSAGE_ID));
        Files.createDirectories(expected.getParent());
        Files.write(expected, new byte[]{1, 2, 3});

        assertEquals(expected.toFile().getCanonicalFile(),
                service.downloadFile(user("U1001"), MESSAGE_ID, false).getCanonicalFile());
    }

    private ChatMessage directMessage() {
        ChatMessage message = message("U2002");
        message.setSendUserId("U1001");
        return message;
    }

    private ChatMessage message(String contactId) {
        ChatMessage message = new ChatMessage();
        message.setMessageId(MESSAGE_ID);
        message.setContactId(contactId);
        message.setSendUserId("U1001");
        message.setSendTime(System.currentTimeMillis());
        message.setFileName("demo.txt");
        return message;
    }

    private TokenUserInfoDto user(String userId) {
        TokenUserInfoDto user = new TokenUserInfoDto();
        user.setUserId(userId);
        return user;
    }

    private File createMessageFile(ChatMessage message) throws Exception {
        String month = DateUtil.format(new Date(message.getSendTime()), DateTimePatternEnum.YYYYMM.getPattern());
        Path file = projectFolder.resolve("file").resolve(month).resolve(MESSAGE_ID + ".txt");
        Files.createDirectories(file.getParent());
        Files.write(file, new byte[]{1, 2, 3});
        return file.toFile();
    }
}
