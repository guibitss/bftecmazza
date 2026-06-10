-- ============================================================
-- INBOXES POR SESSÃO WAHA
-- Cada sessão WAHA (bot, suporte, cada vendedora) vira uma inbox.
-- Inboxes ficam agrupadas por loja na UI.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Tabela inboxes
-- -----------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE inbox_kind AS ENUM ('bot', 'support', 'vendor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS inboxes (
  id           BIGSERIAL PRIMARY KEY,
  store_id     INTEGER  NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  waha_session TEXT     NOT NULL UNIQUE,
  kind         inbox_kind NOT NULL,
  vendor_id    INTEGER  REFERENCES vendors(id),
  display_name TEXT     NOT NULL,
  active       BOOLEAN  NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inboxes_vendor_required CHECK (kind <> 'vendor' OR vendor_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS inboxes_store_idx  ON inboxes(store_id);
CREATE INDEX IF NOT EXISTS inboxes_kind_idx   ON inboxes(kind);

-- -----------------------------------------------------------
-- 2. Popula inboxes a partir de stores (bot + support) e vendors
-- -----------------------------------------------------------
INSERT INTO inboxes (store_id, waha_session, kind, display_name)
SELECT id, bot_session, 'bot', 'Bot' FROM stores WHERE active
ON CONFLICT (waha_session) DO NOTHING;

INSERT INTO inboxes (store_id, waha_session, kind, display_name)
SELECT id, support_session, 'support', 'Suporte' FROM stores WHERE active
ON CONFLICT (waha_session) DO NOTHING;

INSERT INTO inboxes (store_id, waha_session, kind, vendor_id, display_name)
SELECT store_id, waha_session, 'vendor', id, INITCAP(name)
FROM vendors WHERE active
ON CONFLICT (waha_session) DO NOTHING;

-- nomes bonitos pras vendedoras (pode editar via admin depois)
UPDATE inboxes SET display_name = 'Maria Júlia'  WHERE waha_session = 'mariajuliabfcm';
UPDATE inboxes SET display_name = 'Maria Eduarda' WHERE waha_session = 'mariaeduardabfg';

-- -----------------------------------------------------------
-- 3. Refaz user_inboxes apontando para inbox_id (era store_id)
-- -----------------------------------------------------------
DROP POLICY IF EXISTS ui_self_read    ON user_inboxes;
DROP POLICY IF EXISTS ui_admin_write  ON user_inboxes;
DROP TABLE IF EXISTS user_inboxes;

CREATE TABLE user_inboxes (
  user_id    UUID    NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  inbox_id   BIGINT  NOT NULL REFERENCES inboxes(id)   ON DELETE CASCADE,
  can_send   BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, inbox_id)
);
CREATE INDEX user_inboxes_inbox_idx ON user_inboxes(inbox_id);

-- -----------------------------------------------------------
-- 4. Adiciona inbox_id em conversations/messages/scheduled
-- -----------------------------------------------------------
ALTER TABLE conversations       ADD COLUMN IF NOT EXISTS inbox_id BIGINT REFERENCES inboxes(id) ON DELETE CASCADE;
ALTER TABLE messages            ADD COLUMN IF NOT EXISTS inbox_id BIGINT REFERENCES inboxes(id) ON DELETE CASCADE;
ALTER TABLE scheduled_messages  ADD COLUMN IF NOT EXISTS inbox_id BIGINT REFERENCES inboxes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS conv_inbox_recent_idx ON conversations (inbox_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS msg_inbox_created_idx ON messages      (inbox_id, created_at DESC);

-- (chave única por inbox agora — cliente pode falar com bot E com vendor, contas diferentes)
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_store_id_waha_id_key;
DO $$ BEGIN
  CREATE UNIQUE INDEX conv_inbox_waha_unique ON conversations(inbox_id, waha_id);
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- -----------------------------------------------------------
-- 5. resolve_session devolve inbox_id agora
-- -----------------------------------------------------------
DROP FUNCTION IF EXISTS resolve_session(TEXT);
CREATE FUNCTION resolve_session(p_session TEXT)
RETURNS TABLE (inbox_id BIGINT, store_id INTEGER, vendor_id INTEGER, session_role TEXT) AS $$
  SELECT i.id, i.store_id, i.vendor_id, i.kind::text
  FROM inboxes i
  WHERE i.waha_session = p_session AND i.active
  LIMIT 1
$$ LANGUAGE sql STABLE;

-- -----------------------------------------------------------
-- 6. Helpers RLS reescritos pra inbox_id
-- -----------------------------------------------------------
DROP FUNCTION IF EXISTS user_can_access(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS user_can_send(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS user_can_manage(INTEGER) CASCADE;

CREATE OR REPLACE FUNCTION user_can_access_inbox(p_inbox_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM user_inboxes WHERE user_id = auth.uid() AND inbox_id = p_inbox_id
  )
$$;

CREATE OR REPLACE FUNCTION user_can_send_inbox(p_inbox_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM user_inboxes
    WHERE user_id = auth.uid() AND inbox_id = p_inbox_id AND can_send = true
  )
$$;

CREATE OR REPLACE FUNCTION user_can_manage_inbox(p_inbox_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM user_inboxes
    WHERE user_id = auth.uid() AND inbox_id = p_inbox_id AND can_manage = true
  )
$$;

-- helper: tem acesso a QUALQUER inbox da loja?
CREATE OR REPLACE FUNCTION user_can_access_store(p_store_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM user_inboxes ui
    JOIN inboxes i ON i.id = ui.inbox_id
    WHERE ui.user_id = auth.uid() AND i.store_id = p_store_id
  )
$$;

-- -----------------------------------------------------------
-- 7. RLS — inboxes
-- -----------------------------------------------------------
ALTER TABLE inboxes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbox_read   ON inboxes;
DROP POLICY IF EXISTS inbox_admin  ON inboxes;

CREATE POLICY inbox_read  ON inboxes FOR SELECT TO authenticated USING (user_can_access_inbox(id));
CREATE POLICY inbox_admin ON inboxes FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- -----------------------------------------------------------
-- 8. RLS — user_inboxes (admin gerencia, user vê o próprio)
-- -----------------------------------------------------------
ALTER TABLE user_inboxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY ui_self_read   ON user_inboxes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY ui_admin_write ON user_inboxes FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- -----------------------------------------------------------
-- 9. RLS — conversations/messages/scheduled agora por inbox_id
-- -----------------------------------------------------------
DROP POLICY IF EXISTS conv_access  ON conversations;
DROP POLICY IF EXISTS msg_access   ON messages;
DROP POLICY IF EXISTS sched_access ON scheduled_messages;

CREATE POLICY conv_access ON conversations FOR ALL TO authenticated
  USING (inbox_id IS NULL OR user_can_access_inbox(inbox_id))
  WITH CHECK (inbox_id IS NULL OR user_can_send_inbox(inbox_id));

CREATE POLICY msg_access ON messages FOR ALL TO authenticated
  USING (inbox_id IS NULL OR user_can_access_inbox(inbox_id))
  WITH CHECK (inbox_id IS NULL OR user_can_send_inbox(inbox_id));

CREATE POLICY sched_access ON scheduled_messages FOR ALL TO authenticated
  USING (inbox_id IS NULL OR user_can_access_inbox(inbox_id))
  WITH CHECK (inbox_id IS NULL OR user_can_send_inbox(inbox_id));

-- -----------------------------------------------------------
-- 10. RLS — stores/vendors visíveis por escopo (qualquer inbox da loja)
-- -----------------------------------------------------------
DROP POLICY IF EXISTS stores_read   ON stores;
DROP POLICY IF EXISTS stores_manage ON stores;
DROP POLICY IF EXISTS stores_admin  ON stores;
DROP POLICY IF EXISTS vendors_read   ON vendors;
DROP POLICY IF EXISTS vendors_manage ON vendors;
DROP POLICY IF EXISTS vendors_admin  ON vendors;

CREATE POLICY stores_read  ON stores FOR SELECT TO authenticated USING (user_can_access_store(id));
CREATE POLICY stores_admin ON stores FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY vendors_read  ON vendors FOR SELECT TO authenticated USING (user_can_access_store(store_id));
CREATE POLICY vendors_admin ON vendors FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- -----------------------------------------------------------
-- 11. RLS — tabelas auxiliares (leitura por escopo de loja)
-- -----------------------------------------------------------
DROP POLICY IF EXISTS cm_read  ON conversation_memory;
DROP POLICY IF EXISTS tl_read  ON transfer_locks;
DROP POLICY IF EXISTS tfa_read ON transfer_flow_audit;

CREATE POLICY cm_read  ON conversation_memory  FOR SELECT TO authenticated USING (user_can_access_store(store_id));
CREATE POLICY tl_read  ON transfer_locks       FOR SELECT TO authenticated USING (user_can_access_store(store_id));
CREATE POLICY tfa_read ON transfer_flow_audit  FOR SELECT TO authenticated USING (user_can_access_store(store_id));

-- -----------------------------------------------------------
-- 12. Realtime: inclui inboxes
-- -----------------------------------------------------------
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE inboxes;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
