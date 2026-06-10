-- ============================================================
-- "bot" → "IA" em todo o sistema
-- ============================================================

-- 1. inbox_kind: renomeia o valor do enum (preserva todas as referências)
ALTER TYPE inbox_kind RENAME VALUE 'bot' TO 'ai';

-- 2. display_name: "Bot" vira "IA" nas inboxes existentes
UPDATE inboxes SET display_name = 'IA' WHERE display_name = 'Bot';

-- 3. message_author: redundância antiga ('bot' e 'ai' coexistiam).
--    Migra qualquer 'bot' existente para 'ai' e recria o enum sem 'bot'.
ALTER TABLE messages ALTER COLUMN author_type TYPE TEXT;
UPDATE messages SET author_type = 'ai' WHERE author_type = 'bot';

DROP TYPE message_author;
CREATE TYPE message_author AS ENUM ('customer', 'ai', 'vendor', 'support');

ALTER TABLE messages
  ALTER COLUMN author_type TYPE message_author USING author_type::message_author;
