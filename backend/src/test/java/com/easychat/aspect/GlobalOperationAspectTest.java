package com.easychat.aspect;

import com.easychat.annotation.GlobalInterceptor;
import com.easychat.entity.config.AppConfig;
import com.easychat.entity.dto.TokenUserInfoDto;
import com.easychat.exception.BusinessException;
import com.easychat.redis.RedisComponet;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GlobalOperationAspectTest {

    private GlobalOperationAspect aspect;
    private AppConfig appConfig;
    private TokenUserInfoDto tokenUserInfo;
    private JoinPoint joinPoint;

    @BeforeEach
    void setUp() throws Exception {
        aspect = new GlobalOperationAspect();
        appConfig = new AppConfig();
        RedisComponet redisComponet = mock(RedisComponet.class);
        tokenUserInfo = new TokenUserInfoDto();
        tokenUserInfo.setUserId("U1001");
        tokenUserInfo.setAdmin(true);
        when(redisComponet.getTokenUserInfoDto("token")).thenReturn(tokenUserInfo);
        ReflectionTestUtils.setField(aspect, "redisComponet", redisComponet);
        ReflectionTestUtils.setField(aspect, "appConfig", appConfig);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer token");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        Method endpoint = AdminEndpoint.class.getDeclaredMethod("invoke");
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(endpoint);
        joinPoint = mock(JoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void ignoresStaleTokenAdminFlagWhenUserIdIsNotAllowed() {
        ReflectionTestUtils.setField(appConfig, "adminUserIds", "");

        assertThrows(BusinessException.class, () -> aspect.interceptorDo(joinPoint));
    }

    @Test
    void authorizesCurrentAllowlistedUserEvenWhenTokenFlagIsStale() {
        tokenUserInfo.setAdmin(false);
        ReflectionTestUtils.setField(appConfig, "adminUserIds", "U1001");

        assertDoesNotThrow(() -> aspect.interceptorDo(joinPoint));
    }

    private static class AdminEndpoint {
        @GlobalInterceptor(checkAdmin = true)
        public void invoke() {
        }
    }
}
