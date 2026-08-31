-- Run once with a backup before deploying credentialVersion=2 clients.
-- Existing 32-character MD5 values are migrated lazily on the next secure login.
ALTER TABLE user_info MODIFY COLUMN password VARCHAR(255) NOT NULL;
