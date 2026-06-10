-- Message buffer for debounce (replaces Redis lists)
CREATE TABLE IF NOT EXISTS message_buffer (
  chat_id          TEXT        PRIMARY KEY,
  messages         JSONB       NOT NULL DEFAULT '[]',
  last_message     TEXT        NOT NULL DEFAULT '',
  process_after    TIMESTAMPTZ NOT NULL,
  phone            TEXT        NOT NULL,
  conversation_data JSONB      NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conversation memory for AI agent (replaces Redis Chat Memory)
CREATE TABLE IF NOT EXISTS conversation_memory (
  phone      TEXT        PRIMARY KEY,
  messages   JSONB       NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transfer locks with expiration (replaces Redis TTL keys)
CREATE TABLE IF NOT EXISTS transfer_locks (
  source_id  TEXT        PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Vendor round-robin queue (replaces Redis "filavendedores")
-- Fila: maju → aline → julia → beatriz → maju ...
-- Guilherme removido da rotação automática.
CREATE TABLE IF NOT EXISTS vendor_queue (
  id             INTEGER PRIMARY KEY DEFAULT 1,
  current_vendor TEXT    NOT NULL DEFAULT 'maju',
  CONSTRAINT vendor_queue_single_row CHECK (id = 1)
);

INSERT INTO vendor_queue (id, current_vendor)
VALUES (1, 'maju')
ON CONFLICT (id) DO NOTHING;

-- Atomic upsert for message buffer (debounce reset on each new message)
CREATE OR REPLACE FUNCTION upsert_message_buffer(
  p_chat_id          TEXT,
  p_message          TEXT,
  p_phone            TEXT,
  p_conversation_data JSONB
) RETURNS void AS $$
BEGIN
  INSERT INTO message_buffer
    (chat_id, messages, last_message, process_after, phone, conversation_data)
  VALUES (
    p_chat_id,
    jsonb_build_array(p_message),
    p_message,
    NOW() + INTERVAL '30 seconds',
    p_phone,
    p_conversation_data
  )
  ON CONFLICT (chat_id) DO UPDATE SET
    messages          = message_buffer.messages || jsonb_build_array(p_message),
    last_message      = p_message,
    process_after     = NOW() + INTERVAL '30 seconds',
    conversation_data = p_conversation_data;
END;
$$ LANGUAGE plpgsql;

-- Atomic pop of ready messages (prevents double-processing on concurrent cron runs)
CREATE OR REPLACE FUNCTION pop_ready_messages(p_limit INT DEFAULT 10)
RETURNS SETOF message_buffer AS $$
BEGIN
  RETURN QUERY
  DELETE FROM message_buffer
  WHERE chat_id IN (
    SELECT chat_id
    FROM   message_buffer
    WHERE  process_after <= NOW()
    ORDER  BY process_after
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- Enable extensions (run as superuser / in Supabase dashboard)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- After enabling extensions, configure the cron job:
-- Replace <PROJECT_URL> and <SERVICE_ROLE_KEY> with real values,
-- or set via: ALTER DATABASE postgres SET app.supabase_url = '...';
--             ALTER DATABASE postgres SET app.service_role_key = '...';
--
-- SELECT cron.schedule(
--   'process-messages',
--   '* * * * *',
--   $$
--   SELECT net.http_post(
--     url     := current_setting('app.supabase_url') || '/functions/v1/process-messages',
--     headers := jsonb_build_object(
--                  'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--                  'Content-Type',  'application/json'
--                ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- Cleanup job: remove expired locks daily
-- SELECT cron.schedule(
--   'cleanup-expired-locks',
--   '0 3 * * *',
--   $$ DELETE FROM transfer_locks WHERE expires_at < NOW(); $$
-- );
