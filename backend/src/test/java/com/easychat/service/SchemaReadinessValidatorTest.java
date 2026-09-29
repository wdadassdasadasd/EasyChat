package com.easychat.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SchemaReadinessValidatorTest {
    private SchemaReadinessValidator validator;
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void setUp() {
        validator = new SchemaReadinessValidator();
        jdbcTemplate = mock(JdbcTemplate.class);
        ReflectionTestUtils.setField(validator, "jdbcTemplate", jdbcTemplate);
        ReflectionTestUtils.setField(validator, "enabled", true);
        when(jdbcTemplate.queryForObject(anyString(), eq(Integer.class), anyString())).thenReturn(1);
        when(jdbcTemplate.queryForObject(anyString(), eq(Integer.class), anyString(), anyString())).thenReturn(1);
        when(jdbcTemplate.queryForObject(anyString(), eq(Integer.class), anyString(), anyString(), anyString())).thenReturn(1);
    }

    @Test
    void requiresTheFinalMigrationAndExpectedOutboxCollation() {
        assertDoesNotThrow(() -> validator.run(null));

        verify(jdbcTemplate).queryForObject(
                org.mockito.ArgumentMatchers.contains("easychat_schema_migration"),
                eq(Integer.class), eq("p1-3-event-outbox-collation"));
        verify(jdbcTemplate).queryForObject(
                org.mockito.ArgumentMatchers.contains("collation_name"),
                eq(Integer.class), eq("chat_event_outbox"), eq("target_id"), eq("utf8mb4_general_ci"));
    }

    @Test
    void failsClosedWhenTheFinalMigrationIsMissing() {
        when(jdbcTemplate.queryForObject(
                org.mockito.ArgumentMatchers.contains("easychat_schema_migration"),
                eq(Integer.class), eq("p1-3-event-outbox-collation"))).thenReturn(0);

        assertThrows(IllegalStateException.class, () -> validator.run(null));
    }
}
