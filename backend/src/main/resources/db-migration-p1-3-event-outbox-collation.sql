-- Run once after db-migration-p1-2-ha-gates.sql for schemas created with a
-- MySQL 8 default collation different from the legacy contact tables.
-- syncEvents compares this column with user_contact.user_id/contact_id, which
-- are utf8mb4_general_ci in the baseline EasyChat schema.
ALTER TABLE chat_event_outbox
  MODIFY COLUMN target_id VARCHAR(64)
  CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;

INSERT IGNORE INTO easychat_schema_migration(version, applied_at)
VALUES ('p1-3-event-outbox-collation', UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000);
