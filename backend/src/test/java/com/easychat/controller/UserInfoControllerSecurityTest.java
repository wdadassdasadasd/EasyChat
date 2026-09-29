package com.easychat.controller;

import com.easychat.entity.config.AppConfig;
import com.easychat.entity.dto.TokenUserInfoDto;
import com.easychat.entity.po.UserInfo;
import com.easychat.exception.BusinessException;
import com.easychat.redis.RedisComponet;
import com.easychat.service.UserInfoService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserInfoControllerSecurityTest {

    private UserInfoController controller;
    private UserInfoService userInfoService;
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        controller = new UserInfoController();
        userInfoService = mock(UserInfoService.class);
        ReflectionTestUtils.setField(controller, "userInfoService", userInfoService);

        AppConfig appConfig = new AppConfig();
        ReflectionTestUtils.setField(appConfig, "adminUserIds", "");
        ReflectionTestUtils.setField(controller, "appConfig", appConfig);

        TokenUserInfoDto tokenUserInfo = new TokenUserInfoDto();
        tokenUserInfo.setUserId("U1001");
        tokenUserInfo.setNickName("before");
        RedisComponet redisComponet = mock(RedisComponet.class);
        when(redisComponet.getTokenUserInfoDto("token")).thenReturn(tokenUserInfo);
        ReflectionTestUtils.setField(controller, "redisComponet", redisComponet);

        UserInfo stored = new UserInfo();
        stored.setUserId("U1001");
        stored.setNickName("after");
        when(userInfoService.getUserInfoByUserId(anyString())).thenReturn(stored);

        request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer token");
    }

    @Test
    void copiesOnlyEditableProfileFields() throws Exception {
        UserInfo submitted = new UserInfo();
        submitted.setUserId("U9999");
        submitted.setEmail("admin@example.com");
        submitted.setPassword("attacker-value");
        submitted.setStatus(0);
        submitted.setCreateTime(new Date());
        submitted.setLastLoginTime(new Date());
        submitted.setLastOffTime(123L);
        submitted.setNickName("after");
        submitted.setJoinType(1);
        submitted.setSex(0);
        submitted.setPersonalSignature("hello");
        submitted.setAreaName("area");
        submitted.setAreaCode("code");

        controller.saveUserInfo(request, submitted, null, null);

        ArgumentCaptor<UserInfo> captor = ArgumentCaptor.forClass(UserInfo.class);
        verify(userInfoService).updateUserInfo(captor.capture(), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.isNull());
        UserInfo update = captor.getValue();
        assertEquals("U1001", update.getUserId());
        assertEquals("after", update.getNickName());
        assertEquals("hello", update.getPersonalSignature());
        assertNull(update.getEmail());
        assertNull(update.getPassword());
        assertNull(update.getStatus());
        assertNull(update.getCreateTime());
        assertNull(update.getLastLoginTime());
        assertNull(update.getLastOffTime());
    }

    @Test
    void rejectsAvatarWithoutCoverBeforeCallingService() {
        UserInfo submitted = new UserInfo();
        submitted.setNickName("after");
        MockMultipartFile avatar = new MockMultipartFile("avatarFile", "avatar.png", "image/png", new byte[]{1});

        assertThrows(BusinessException.class, () -> controller.saveUserInfo(request, submitted, avatar, null));
    }

    @Test
    void rejectsInvalidProfileFieldsBeforeCallingService() {
        UserInfo submitted = new UserInfo();
        for (String nickName : new String[]{"", "   ", "123456789012345678901"}) {
            submitted.setNickName(nickName);
            assertThrows(BusinessException.class, () -> controller.saveUserInfo(request, submitted, null, null));
        }
        submitted.setNickName("valid");
        submitted.setJoinType(9);
        assertThrows(BusinessException.class, () -> controller.saveUserInfo(request, submitted, null, null));
        submitted.setJoinType(0);
        submitted.setSex(9);
        assertThrows(BusinessException.class, () -> controller.saveUserInfo(request, submitted, null, null));

        verifyNoInteractions(userInfoService);
    }
}
