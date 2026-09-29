package com.easychat.controller;

import com.easychat.entity.config.AppConfig;
import com.easychat.entity.dto.SysSettingDto;
import com.easychat.exception.BusinessException;
import com.easychat.redis.RedisComponet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class AdminSettingControllerTest {

    @TempDir
    Path projectFolder;

    @Test
    void rejectsRobotAvatarWithoutCoverBeforeWritingAnyState() throws Exception {
        AdminSettingController controller = new AdminSettingController();
        AppConfig appConfig = new AppConfig();
        ReflectionTestUtils.setField(appConfig, "projectFolder", projectFolder.toString());
        RedisComponet redisComponet = mock(RedisComponet.class);
        MultipartFile robotFile = mock(MultipartFile.class);
        ReflectionTestUtils.setField(controller, "appConfig", appConfig);
        ReflectionTestUtils.setField(controller, "redisComponet", redisComponet);

        assertThrows(BusinessException.class,
                () -> controller.saveSysSetting(new SysSettingDto(), robotFile, null));

        verify(robotFile, never()).transferTo(any(File.class));
        verifyNoInteractions(redisComponet);
    }
}
