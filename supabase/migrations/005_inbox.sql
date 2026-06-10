-- ============================================================
-- INBOX: conversations + messages + bucket de mídia + helper
-- Substitui o storage de mensagens do Chatwoot (paralelo durante a migração).
-- ============================================================

-- -----------------------------------------------------------
-- 1. conversations: uma row por chat_id por loja
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  waha_id             TEXT    NOT NULL,             -- ex: 5544...@c.us ou @lid
  customer_phone      TEXT,
  customer_name       TEXT,
  status              TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'archived')),
  assigned_vendor_id  INTEGER REFERENCES vendors(id),
  unread_count        INTEGER NOT NULL DEFAULT 0,
  last_message_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_preview TEXT,
  first_message_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, waha_id)
);

CREATE INDEX IF NOT EXISTS conv_store_recent_idx ON conversations (store_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conv_vendor_idx       ON conversations (assigned_vendor_id) WHERE assigned_vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conv_status_idx       ON conversations (store_id, status);

-- -----------------------------------------------------------
-- 2. messages: todas as mensagens, in e out
-- -----------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE message_kind AS ENUM ('text','audio','image','video','document','location','sticker','reaction','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_author AS ENUM ('customer','ai','vendor','support','bot');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT  NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  store_id        INTEGER NOT NULL REFERENCES stores(id),
  waha_message_id TEXT UNIQUE,                       -- idempotência: WAHA pode repetir eventos
  direction       TEXT    NOT NULL CHECK (direction IN ('in','out')),
  author_type     message_author NOT NULL,
  author_id       INTEGER,                            -- vendor_id se author_type = 'vendor'
  author_session  TEXT,                               -- sessão WAHA usada (auditoria)
  kind            message_kind NOT NULL DEFAULT 'text',
  body            TEXT,                               -- texto ou caption
  media_url       TEXT,                               -- URL pública no Supabase Storage
  media_mime      TEXT,
  media_filename  TEXT,
  reply_to_id     BIGINT REFERENCES messages(id),
  ack             SMALLINT DEFAULT 0,                 -- 0 pending, 1 server, 2 device, 3 read, 4 played
  sent_via        TEXT,                               -- 'waha' | 'ai' | 'manual'
  raw             JSONB,                              -- payload bruto pra debug
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS msg_conv_created_idx ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS msg_store_created_idx ON messages (store_id, created_at DESC);

-- -----------------------------------------------------------
-- 3. resolve_session: dada uma sessão WAHA, devolve (store, role, vendor?)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_session(p_session TEXT)
RETURNS TABLE (store_id INTEGER, vendor_id INTEGER, session_role TEXT) AS $$
  SELECT s.id, NULL::INTEGER, 'bot'
    FROM stores s WHERE s.bot_session = p_session
  UNION ALL
  SELECT s.id, NULL::INTEGER, 'support'
    FROM stores s WHERE s.support_session = p_session
  UNION ALL
  SELECT v.store_id, v.id, 'vendor'
    FROM vendors v WHERE v.waha_session = p_session
  LIMIT 1
$$ LANGUAGE sql STABLE;

-- -----------------------------------------------------------
-- 4. Trigger pra atualizar conversations a cada mensagem nova
--    (last_message_at, last_message_preview, unread_count)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION bump_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations SET
    last_message_at      = NEW.created_at,
    last_message_preview = LEFT(
      COALESCE(NULLIF(NEW.body, ''), '[' || NEW.kind::text || ']'),
      120
    ),
    unread_count = CASE
      WHEN NEW.direction = 'in' THEN unread_count + 1
      ELSE unread_count
    END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bump_conv ON messages;
CREATE TRIGGER trg_bump_conv
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION bump_conversation_on_message();

-- -----------------------------------------------------------
-- 5. RLS — leitura por escopo (admin = tudo; gestor = loja; vendor = só suas)
-- -----------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conv_read ON conversations;
CREATE POLICY conv_read ON conversations FOR SELECT TO authenticated
  USING (
    app_user_role() = 'admin'
    OR (app_user_role() = 'gestor'   AND store_id = app_user_store_id())
    OR (app_user_role() = 'vendedor' AND store_id = app_user_store_id()
        AND (assigned_vendor_id = app_user_vendor_id() OR assigned_vendor_id IS NULL))
  );

DROP POLICY IF EXISTS msg_read ON messages;
CREATE POLICY msg_read ON messages FOR SELECT TO authenticated
  USING (
    app_user_role() = 'admin'
    OR (app_user_role() = 'gestor'   AND store_id = app_user_store_id())
    OR (app_user_role() = 'vendedor' AND EXISTS (
          SELECT 1 FROM conversations c
          WHERE c.id = messages.conversation_id
            AND c.store_id = app_user_store_id()
            AND (c.assigned_vendor_id = app_user_vendor_id() OR c.assigned_vendor_id IS NULL)
        ))
  );

-- -----------------------------------------------------------
-- 6. Realtime: habilita replicação pra UI assinar em tempo real
-- -----------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- -----------------------------------------------------------
-- 7. Bucket de mídia (público — conforme solicitado)
-- -----------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Policy: leitura pública (bucket é public, mas mantemos policy explícita)
DROP POLICY IF EXISTS media_public_read ON storage.objects;
CREATE POLICY media_public_read ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'media');

-- Escrita: só service_role (Edge Functions). authenticated não escreve direto.
DROP POLICY IF EXISTS media_service_write ON storage.objects;
CREATE POLICY media_service_write ON storage.objects FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'media');
