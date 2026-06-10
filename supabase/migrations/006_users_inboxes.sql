-- ============================================================
-- USUÁRIOS x CAIXAS DE ENTRADA (modelo N:N)
-- Desacopla pessoa de loja/vendedora — admin libera acessos.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Remove policies/funções antigas que dependem do modelo anterior
-- -----------------------------------------------------------
-- conversations / messages
DROP POLICY IF EXISTS conv_read ON conversations;
DROP POLICY IF EXISTS msg_read  ON messages;
-- legados
DROP POLICY IF EXISTS app_users_read_self   ON app_users;
DROP POLICY IF EXISTS app_users_admin_all   ON app_users;
DROP POLICY IF EXISTS app_users_gestor_read ON app_users;
DROP POLICY IF EXISTS stores_admin_all      ON stores;
DROP POLICY IF EXISTS stores_read_own       ON stores;
DROP POLICY IF EXISTS vendors_admin_all     ON vendors;
DROP POLICY IF EXISTS vendors_read_store    ON vendors;
DROP POLICY IF EXISTS cm_read               ON conversation_memory;
DROP POLICY IF EXISTS tl_read               ON transfer_locks;
DROP POLICY IF EXISTS tfa_read              ON transfer_flow_audit;

DROP FUNCTION IF EXISTS app_user_role()      CASCADE;
DROP FUNCTION IF EXISTS app_user_store_id()  CASCADE;
DROP FUNCTION IF EXISTS app_user_vendor_id() CASCADE;

-- -----------------------------------------------------------
-- 2. Refaz app_users (sem role/store_id/vendor_id; com is_admin)
-- -----------------------------------------------------------
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: quem era role='admin' vira is_admin=true
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'role'
  ) THEN
    EXECUTE 'UPDATE app_users SET is_admin = (role = ''admin''::app_role)';
  END IF;
END $$;

-- Remove constraints velhas que dependem das colunas a serem dropadas
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_store_required;
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_vendor_required;

-- Dropa colunas legadas
ALTER TABLE app_users DROP COLUMN IF EXISTS role;
ALTER TABLE app_users DROP COLUMN IF EXISTS store_id;
ALTER TABLE app_users DROP COLUMN IF EXISTS vendor_id;

DROP TYPE IF EXISTS app_role;

CREATE INDEX IF NOT EXISTS app_users_admin_idx ON app_users(is_admin) WHERE is_admin = true;

-- -----------------------------------------------------------
-- 3. user_inboxes — N:N pessoa × loja
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_inboxes (
  user_id     UUID    NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  store_id    INTEGER NOT NULL REFERENCES stores(id)    ON DELETE CASCADE,
  can_send    BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, store_id)
);

CREATE INDEX IF NOT EXISTS user_inboxes_store_idx ON user_inboxes(store_id);

-- -----------------------------------------------------------
-- 4. scheduled_messages — disparo programado pela UI
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT  NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  store_id        INTEGER NOT NULL REFERENCES stores(id),
  user_id         UUID    NOT NULL REFERENCES app_users(id),
  via_session     TEXT    NOT NULL,      -- sessão WAHA escolhida no dropdown
  kind            message_kind NOT NULL DEFAULT 'text',
  body            TEXT,
  media_url       TEXT,
  media_mime      TEXT,
  media_filename  TEXT,
  send_at         TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','cancelled')),
  sent_at         TIMESTAMPTZ,
  sent_message_id BIGINT REFERENCES messages(id),
  error_msg       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sched_due_idx ON scheduled_messages (send_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS sched_conv_idx ON scheduled_messages (conversation_id, send_at);

-- -----------------------------------------------------------
-- 5. Helpers
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM app_users WHERE id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION user_can_access(p_store_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM user_inboxes
    WHERE user_id = auth.uid() AND store_id = p_store_id
  )
$$;

CREATE OR REPLACE FUNCTION user_can_send(p_store_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM user_inboxes
    WHERE user_id = auth.uid() AND store_id = p_store_id AND can_send = true
  )
$$;

CREATE OR REPLACE FUNCTION user_can_manage(p_store_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM user_inboxes
    WHERE user_id = auth.uid() AND store_id = p_store_id AND can_manage = true
  )
$$;

-- -----------------------------------------------------------
-- 6. RLS — app_users
-- -----------------------------------------------------------
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_users_self ON app_users FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY app_users_admin_all ON app_users FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- -----------------------------------------------------------
-- 7. RLS — user_inboxes
-- -----------------------------------------------------------
ALTER TABLE user_inboxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY ui_self_read ON user_inboxes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY ui_admin_write ON user_inboxes FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- -----------------------------------------------------------
-- 8. RLS — stores / vendors
-- -----------------------------------------------------------
ALTER TABLE stores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY stores_read   ON stores FOR SELECT TO authenticated USING (user_can_access(id));
CREATE POLICY stores_manage ON stores FOR UPDATE TO authenticated USING (user_can_manage(id)) WITH CHECK (user_can_manage(id));
CREATE POLICY stores_admin  ON stores FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY vendors_read   ON vendors FOR SELECT TO authenticated USING (user_can_access(store_id));
CREATE POLICY vendors_manage ON vendors FOR UPDATE TO authenticated USING (user_can_manage(store_id)) WITH CHECK (user_can_manage(store_id));
CREATE POLICY vendors_admin  ON vendors FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- -----------------------------------------------------------
-- 9. RLS — conversations / messages / scheduled
-- -----------------------------------------------------------
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_messages  ENABLE ROW LEVEL SECURITY;

CREATE POLICY conv_access ON conversations FOR ALL TO authenticated
  USING (user_can_access(store_id))
  WITH CHECK (user_can_send(store_id));

CREATE POLICY msg_access ON messages FOR ALL TO authenticated
  USING (user_can_access(store_id))
  WITH CHECK (user_can_send(store_id));

CREATE POLICY sched_access ON scheduled_messages FOR ALL TO authenticated
  USING (user_can_access(store_id))
  WITH CHECK (user_can_send(store_id));

-- -----------------------------------------------------------
-- 10. RLS — tabelas auxiliares (leitura por escopo)
-- -----------------------------------------------------------
ALTER TABLE conversation_memory   ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_locks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_flow_audit   ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_read  ON conversation_memory  FOR SELECT TO authenticated USING (user_can_access(store_id));
CREATE POLICY tl_read  ON transfer_locks       FOR SELECT TO authenticated USING (user_can_access(store_id));
CREATE POLICY tfa_read ON transfer_flow_audit  FOR SELECT TO authenticated USING (user_can_access(store_id));
