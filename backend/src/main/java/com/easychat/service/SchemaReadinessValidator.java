package com.easychat.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;

/** Fails fast when the documented V2 SQL migrations were not deployed. */
@Component
public class SchemaReadinessValidator implements ApplicationRunner {
    private static final Logger logger = LoggerFactory.getLogger(SchemaReadinessValidator.class);

    @Resource
    private JdbcTemplate jdbcTemplate;

    @Value("${easychat.schema-validation.enabled:true}")
    private boolean enabled;

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) return;
        requireTable("chat_event_outbox");
        requireTable("chat_read_receipt");
        requireTable("easychat_schema_migration");
        requireTable("chat_upload_session");
        requireTable("chat_upload_part");
        requireColumn("chat_message", "upload_state");
        requireColumn("chat_message", "file_storage_provider");
        requireColumn("chat_message", "file_object_key");
        requireIndex("chat_event_outbox", "idx_chat_event_outbox_target_sequence");
        requireMigration("p1-2-ha-gates");
        requireMigration("p1-3-event-outbox-collation");
        requireColumnCollation("chat_event_outbox", "target_id", "utf8mb4_general_ci");
        logger.info("V2 schema readiness check passed");
    }

    private void requireTable(String table) {
        require("select count(1) from information_schema.tables where table_schema=database() and table_name=?", table, "table");
    }

    private void requireColumn(String table, String column) {
        Integer count = jdbcTemplate.queryForObject("select count(1) from information_schema.columns where table_schema=database() and table_name=? and column_name=?", Integer.class, table, column);
        if (count == null || count == 0) fail("column");
    }

    private void requireIndex(String table, String index) {
        Integer count = jdbcTemplate.queryForObject("select count(1) from information_schema.statistics where table_schema=database() and table_name=? and index_name=?", Integer.class, table, index);
        if (count == null || count == 0) fail("index");
    }

    private void requireMigration(String version) {
        Integer count = jdbcTemplate.queryForObject("select count(1) from easychat_schema_migration where version=?", Integer.class, version);
        if (count == null || count == 0) fail("migration version");
    }

    private void requireColumnCollation(String table, String column, String collation) {
        Integer count = jdbcTemplate.queryForObject(
                "select count(1) from information_schema.columns where table_schema=database() and table_name=? and column_name=? and collation_name=?",
                Integer.class, table, column, collation);
        if (count == null || count == 0) fail("column collation");
    }

    private void require(String sql, String table, String kind) {
        Integer count = jdbcTemplate.queryForObject(sql, Integer.class, table);
        if (count == null || count == 0) fail(kind);
    }

    private void fail(String kind) {
        logger.error("V2 schema readiness check failed: missing required {}. Apply the documented versioned migrations before starting this node.", kind);
        throw new IllegalStateException("Required EasyChat V2 database migration is missing");
    }
}
