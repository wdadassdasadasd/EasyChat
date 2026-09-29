-- P1.2: durable upload metadata and a manual migration ledger. Apply after P1.1.
CREATE TABLE IF NOT EXISTS easychat_schema_migration (
  version VARCHAR(64) NOT NULL,
  applied_at BIGINT NOT NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE chat_message
  ADD COLUMN file_storage_provider VARCHAR(16) NULL,
  ADD COLUMN file_object_key VARCHAR(512) NULL;

CREATE TABLE IF NOT EXISTS chat_upload_session (
  message_id BIGINT NOT NULL,
  upload_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  storage_provider VARCHAR(16) NOT NULL DEFAULT 'LOCAL',
  object_key VARCHAR(512) NULL,
  total_chunks INT NOT NULL,
  file_size BIGINT NOT NULL,
  file_checksum VARCHAR(128) NULL,
  lease_until BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (message_id),
  UNIQUE KEY uk_chat_upload_session_upload_id (upload_id),
  KEY idx_chat_upload_session_recovery (status, lease_until, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_upload_part (
  message_id BIGINT NOT NULL,
  chunk_index INT NOT NULL,
  checksum VARCHAR(128) NULL,
  part_size BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (message_id, chunk_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO easychat_schema_migration(version, applied_at)
VALUES ('p1-2-ha-gates', UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000);
