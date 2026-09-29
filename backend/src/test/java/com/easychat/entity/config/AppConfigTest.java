package com.easychat.entity.config;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AppConfigTest {

    @Test
    void matchesOnlyExplicitTrimmedUserIds() {
        AppConfig config = new AppConfig();
        ReflectionTestUtils.setField(config, "adminUserIds", " U1001, U1002, U1001 ");

        assertTrue(config.isAdminUserId("U1001"));
        assertTrue(config.isAdminUserId(" U1002 "));
        assertFalse(config.isAdminUserId("U100"));
        assertFalse(config.isAdminUserId(""));
        assertFalse(config.isAdminUserId(null));
    }

    @Test
    void defaultsToNoAdministrators() {
        AppConfig config = new AppConfig();
        ReflectionTestUtils.setField(config, "adminUserIds", "");

        assertFalse(config.isAdminUserId("U1001"));
    }
}
