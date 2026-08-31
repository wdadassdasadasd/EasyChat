-- P1.1: server-authoritative unread receipts. This migration is additive.
CREATE TABLE IF NOT EXISTS chat_read_receipt (
  user_id VARCHAR(64) NOT NULL,
  read_request_id VARCHAR(64) NOT NULL,
  contact_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, read_request_id),
  KEY idx_chat_read_receipt_created (created_at)
);

CREATE INDEX idx_chat_event_outbox_target_sequence
  ON chat_event_outbox(target_type, target_id, server_sequence);

ALTER TABLE chat_message
  ADD COLUMN IF NOT EXISTS upload_state VARCHAR(16) NOT NULL DEFAULT 'PENDING';

CREATE INDEX idx_chat_message_upload_state
  ON chat_message(upload_state, message_id);
