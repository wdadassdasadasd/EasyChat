-- Run after db-migration-p1-reliable-events.sql.  This is additive and safe
-- for an already deployed P1 schema on MySQL 8+.
ALTER TABLE chat_session_user
  ADD COLUMN no_read_count INT NOT NULL DEFAULT 0;

ALTER TABLE chat_event_outbox
  ADD COLUMN next_attempt_at BIGINT NULL;

CREATE INDEX idx_chat_event_outbox_retry
  ON chat_event_outbox(status, next_attempt_at, lease_until, server_sequence);
