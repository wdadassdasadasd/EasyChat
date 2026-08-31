-- Run once before deploying the V2-only client. MySQL 8+.
ALTER TABLE chat_message
  ADD COLUMN client_message_id VARCHAR(36) NULL;

ALTER TABLE chat_message
  ADD UNIQUE KEY uk_chat_message_sender_client_message (send_user_id, client_message_id);

CREATE TABLE chat_event_outbox (
  server_sequence BIGINT NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(16) NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  lease_until BIGINT NULL,
  published_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  occurred_at BIGINT NOT NULL,
  PRIMARY KEY (server_sequence),
  UNIQUE KEY uk_chat_event_outbox_event_id (event_id),
  KEY idx_chat_event_outbox_dispatch (status, lease_until, server_sequence),
  KEY idx_chat_event_outbox_target_cursor (target_type, target_id, server_sequence),
  KEY idx_chat_event_outbox_occurred_at (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
