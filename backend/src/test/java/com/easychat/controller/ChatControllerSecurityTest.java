package com.easychat.controller;

import com.easychat.entity.config.AppConfig;
import com.easychat.entity.constants.Constants;
import com.easychat.entity.dto.TokenUserInfoDto;
import com.easychat.exception.BusinessException;
import com.easychat.redis.RedisComponet;
import com.easychat.service.ChatMessageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatControllerSecurityTest {

    @TempDir
    Path projectFolder;

    private ChatController controller;
    private ChatMessageService chatMessageService;

    @BeforeEach
    void setUp() {
        controller = new ChatController();
        chatMessageService = mock(ChatMessageService.class);
        AppConfig appConfig = new AppConfig();
        ReflectionTestUtils.setField(appConfig, "projectFolder", projectFolder.toString());
        ReflectionTestUtils.setField(controller, "appConfig", appConfig);
        ReflectionTestUtils.setField(controller, "chatMessageService", chatMessageService);

        RedisComponet redisComponet = mock(RedisComponet.class);
        TokenUserInfoDto tokenUserInfo = new TokenUserInfoDto();
        tokenUserInfo.setUserId("U12345678901");
        when(redisComponet.getTokenUserInfoDto("test-token")).thenReturn(tokenUserInfo);
        ReflectionTestUtils.setField(controller, "redisComponet", redisComponet);
    }

    @Test
    void resolvesOnlyAllowedAvatarIdsInsideTheAvatarDirectory() throws Exception {
        Path avatarFolder = projectFolder.resolve("file/avatar");
        Files.createDirectories(avatarFolder);
        Files.write(avatarFolder.resolve("U12345678901.png"), new byte[]{1});
        Files.write(avatarFolder.resolve("G1.png"), new byte[]{1});
        Files.write(avatarFolder.resolve(Constants.ROBOT_UID + ".png"), new byte[]{1});

        assertEquals("U12345678901.png", resolveAvatar("U12345678901", false).getName());
        assertEquals("G1.png", resolveAvatar("G1", false).getName());
        assertEquals(Constants.ROBOT_UID + ".png", resolveAvatar(Constants.ROBOT_UID, false).getName());
    }

    @Test
    void rejectsTraversalSeparatorsAndAbsoluteAvatarIds() throws Exception {
        for (String fileId : new String[]{"../secret", "U123/../secret", "U123\\..\\secret", "/tmp/secret", "U123%2Fsecret"}) {
            InvocationTargetException error = assertThrows(InvocationTargetException.class, () -> resolveAvatar(fileId, false));
            assertEquals(BusinessException.class, error.getCause().getClass());
        }
    }

    @Test
    void rejectsAvatarSymlinksThatEscapeTheAvatarDirectory() throws Exception {
        Path avatarFolder = projectFolder.resolve("file/avatar");
        Files.createDirectories(avatarFolder);
        Path outsideFile = projectFolder.resolve("outside.png");
        Files.write(outsideFile, new byte[]{1});
        try {
            Files.createSymbolicLink(avatarFolder.resolve("U12345678901.png"), outsideFile);
        } catch (UnsupportedOperationException | java.io.IOException exception) {
            Assumptions.assumeTrue(false, "Symbolic links are unavailable in this test environment");
        }

        InvocationTargetException error = assertThrows(InvocationTargetException.class,
                () -> resolveAvatar("U12345678901", false));
        assertEquals(BusinessException.class, error.getCause().getClass());
    }

    @Test
    void passesMissingOrEmptyLegacyCoverAsNull() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer test-token");
        MockMultipartFile file = new MockMultipartFile("file", "demo.txt", "text/plain", new byte[]{1});

        controller.uploadFile(request, 1L, file, new MockMultipartFile("cover", new byte[0]));
        verify(chatMessageService).saveMessageFile("U12345678901", 1L, file, null);
        controller.uploadFile(request, 2L, file, null);
        verify(chatMessageService).saveMessageFile("U12345678901", 2L, file, null);
    }

    @Test
    void preservesAProvidedLegacyCover() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer test-token");
        MockMultipartFile file = new MockMultipartFile("file", "demo.txt", "text/plain", new byte[]{1});
        MockMultipartFile cover = new MockMultipartFile("cover", "cover.jpg", "image/jpeg", new byte[]{2});

        controller.uploadFile(request, 1L, file, cover);

        verify(chatMessageService).saveMessageFile("U12345678901", 1L, file, cover);
    }

    private File resolveAvatar(String fileId, boolean showCover) throws Exception {
        Method method = ChatController.class.getDeclaredMethod("resolveAvatarFile", String.class, Boolean.class);
        method.setAccessible(true);
        return (File) method.invoke(controller, fileId, showCover);
    }
}
