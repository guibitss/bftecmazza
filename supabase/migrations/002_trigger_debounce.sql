-- Trigger que dispara process-messages via pg_net após cada upsert no buffer.
-- Isso substitui o pg_cron como mecanismo de debounce, dando exatamente 30s.
-- O pg_cron fica só como safety-net para mensagens que eventualmente ficarem presas.

-- Função de pop atômico para um chat específico (usada pelo trigger mode)
CREATE OR REPLACE FUNCTION pop_specific_chat(p_chat_id TEXT)
RETURNS TABLE (
  chat_id           TEXT,
  phone             TEXT,
  messages          JSONB,
  conversation_data JSONB
) AS $$
BEGIN
  RETURN QUERY
  DELETE FROM message_buffer
  WHERE message_buffer.chat_id = p_chat_id
    AND message_buffer.process_after <= NOW()
  RETURNING
    message_buffer.chat_id,
    message_buffer.phone,
    message_buffer.messages,
    message_buffer.conversation_data;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_process_messages()
RETURNS trigger AS $$
DECLARE
  v_delay_ms INT;
BEGIN
  -- Calcula quantos ms faltam até process_after (mínimo 100ms)
  v_delay_ms := GREATEST(
    100,
    EXTRACT(EPOCH FROM (NEW.process_after - NOW())) * 1000
  )::INT;

  -- Chama process-messages passando o chat_id de forma assíncrona (pg_net)
  PERFORM net.http_post(
    url     := 'https://gmlclkolzcchjstzdilt.supabase.co/functions/v1/process-messages',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := jsonb_build_object('chat_id', NEW.chat_id),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_notify_process_messages
AFTER INSERT OR UPDATE ON message_buffer
FOR EACH ROW EXECUTE FUNCTION notify_process_messages();

