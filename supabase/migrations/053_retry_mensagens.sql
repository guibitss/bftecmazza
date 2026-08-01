-- Rede de segurança pra mensagem que falha no processamento.
--
-- Problema (01/08/2026): pop_specific_chat/pop_ready_messages fazem
-- DELETE...RETURNING — a mensagem sai do buffer ANTES de ser processada. Se a
-- IA falhar depois (ex: OpenAI sem créditos), o lead era descartado em silêncio
-- e ninguém era avisado. Ficou 6h invisível até a loja reclamar.
--
-- Agora: em vez de descartar, o process-messages reenfileira com backoff; após
-- MAX tentativas a mensagem vai pra failed_messages (dead letter) e dispara alerta.

-- Quantas vezes esta mensagem já foi tentada
ALTER TABLE message_buffer ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

-- Mensagens que esgotaram as tentativas — ficam auditáveis pra reprocessar
CREATE TABLE IF NOT EXISTS failed_messages (
  id                bigserial PRIMARY KEY,
  chat_id           text NOT NULL,
  phone             text,
  store_id          int,
  messages          jsonb,
  conversation_data jsonb,
  attempts          int,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reprocessed_at    timestamptz
);
ALTER TABLE failed_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS failed_messages_created_idx ON failed_messages (created_at DESC);

/**
 * Devolve a mensagem ao buffer pra nova tentativa, com backoff.
 * Se o cliente mandou mensagem nova nesse meio tempo, concatena (não perde nada
 * e não duplica a linha — chat_id é a chave).
 */
CREATE OR REPLACE FUNCTION requeue_message_buffer(
  p_chat_id           TEXT,
  p_messages          JSONB,
  p_phone             TEXT,
  p_conversation_data JSONB,
  p_store_id          INT,
  p_attempts          INT,
  p_delay_seconds     INT DEFAULT 60
) RETURNS void AS $$
BEGIN
  INSERT INTO message_buffer
    (chat_id, messages, last_message, process_after, phone, conversation_data, store_id, attempts)
  VALUES (
    p_chat_id,
    p_messages,
    COALESCE(p_messages->>(GREATEST(jsonb_array_length(p_messages), 1) - 1), ''),
    NOW() + (p_delay_seconds || ' seconds')::INTERVAL,
    p_phone,
    p_conversation_data,
    p_store_id,
    p_attempts
  )
  ON CONFLICT (chat_id) DO UPDATE SET
    -- mensagem nova chegou enquanto falhava: a que falhou vem primeiro
    messages          = p_messages || message_buffer.messages,
    process_after     = NOW() + (p_delay_seconds || ' seconds')::INTERVAL,
    conversation_data = COALESCE(message_buffer.conversation_data, p_conversation_data),
    attempts          = p_attempts;
END;
$$ LANGUAGE plpgsql;

/**
 * Mensagem esgotou as tentativas: guarda pra auditoria/reprocesso.
 */
CREATE OR REPLACE FUNCTION record_failed_message(
  p_chat_id           TEXT,
  p_phone             TEXT,
  p_store_id          INT,
  p_messages          JSONB,
  p_conversation_data JSONB,
  p_attempts          INT,
  p_error             TEXT
) RETURNS void AS $$
BEGIN
  INSERT INTO failed_messages
    (chat_id, phone, store_id, messages, conversation_data, attempts, last_error)
  VALUES
    (p_chat_id, p_phone, p_store_id, p_messages, p_conversation_data, p_attempts, LEFT(p_error, 500));
END;
$$ LANGUAGE plpgsql;
