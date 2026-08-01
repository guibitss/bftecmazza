-- pop_specific_chat passa a devolver store_id e attempts (o retry precisa deles)
DROP FUNCTION IF EXISTS pop_specific_chat(TEXT);
CREATE OR REPLACE FUNCTION pop_specific_chat(p_chat_id TEXT)
RETURNS TABLE (
  chat_id           TEXT,
  phone             TEXT,
  messages          JSONB,
  conversation_data JSONB,
  store_id          INT,
  attempts          INT
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
    message_buffer.conversation_data,
    message_buffer.store_id,
    message_buffer.attempts;
END;
$$ LANGUAGE plpgsql;
