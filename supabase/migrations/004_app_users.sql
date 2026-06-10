-- ============================================================
-- CRM: tabela de usuários da aplicação + RLS por perfil
-- ============================================================

-- Enum de perfil
DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('admin', 'gestor', 'vendedor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela de usuários do CRM (vinculada ao auth.users do Supabase)
CREATE TABLE IF NOT EXISTS app_users (
  id          UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT    NOT NULL UNIQUE,
  name        TEXT,
  role        app_role NOT NULL,
  store_id    INTEGER REFERENCES stores(id) ON DELETE SET NULL,
  vendor_id   INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- gestor e vendedor precisam de loja; admin não
  CONSTRAINT app_users_store_required
    CHECK (role = 'admin' OR store_id IS NOT NULL),
  -- vendedor precisa estar ligado a um vendor da tabela
  CONSTRAINT app_users_vendor_required
    CHECK (role <> 'vendedor' OR vendor_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS app_users_store_idx ON app_users(store_id);
CREATE INDEX IF NOT EXISTS app_users_role_idx  ON app_users(role);

-- Helper: pega role do usuário logado
CREATE OR REPLACE FUNCTION app_user_role()
RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM app_users WHERE id = auth.uid()
$$;

-- Helper: pega store_id do usuário logado
CREATE OR REPLACE FUNCTION app_user_store_id()
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT store_id FROM app_users WHERE id = auth.uid()
$$;

-- Helper: pega vendor_id do usuário logado
CREATE OR REPLACE FUNCTION app_user_vendor_id()
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vendor_id FROM app_users WHERE id = auth.uid()
$$;

-- ============================================================
-- RLS: app_users
-- ============================================================
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Cada usuário consegue ler o próprio perfil (necessário pra UI saber a role)
DROP POLICY IF EXISTS app_users_read_self ON app_users;
CREATE POLICY app_users_read_self ON app_users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Admin vê todos
DROP POLICY IF EXISTS app_users_admin_all ON app_users;
CREATE POLICY app_users_admin_all ON app_users
  FOR ALL TO authenticated
  USING (app_user_role() = 'admin')
  WITH CHECK (app_user_role() = 'admin');

-- Gestor vê usuários da loja dele
DROP POLICY IF EXISTS app_users_gestor_read ON app_users;
CREATE POLICY app_users_gestor_read ON app_users
  FOR SELECT TO authenticated
  USING (app_user_role() = 'gestor' AND store_id = app_user_store_id());

-- ============================================================
-- RLS: stores
-- ============================================================
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_admin_all ON stores;
CREATE POLICY stores_admin_all ON stores
  FOR ALL TO authenticated
  USING (app_user_role() = 'admin')
  WITH CHECK (app_user_role() = 'admin');

DROP POLICY IF EXISTS stores_read_own ON stores;
CREATE POLICY stores_read_own ON stores
  FOR SELECT TO authenticated
  USING (id = app_user_store_id() OR app_user_role() = 'admin');

-- ============================================================
-- RLS: vendors
-- ============================================================
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendors_admin_all ON vendors;
CREATE POLICY vendors_admin_all ON vendors
  FOR ALL TO authenticated
  USING (app_user_role() = 'admin')
  WITH CHECK (app_user_role() = 'admin');

DROP POLICY IF EXISTS vendors_read_store ON vendors;
CREATE POLICY vendors_read_store ON vendors
  FOR SELECT TO authenticated
  USING (
    app_user_role() = 'admin'
    OR (app_user_role() = 'gestor' AND store_id = app_user_store_id())
    OR (app_user_role() = 'vendedor' AND id = app_user_vendor_id())
  );

-- ============================================================
-- conversation_memory + transfer_locks + transfer_flow_audit:
-- por loja, mantendo service_role com acesso total (via bypassrls)
-- ============================================================
ALTER TABLE conversation_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_read ON conversation_memory;
CREATE POLICY cm_read ON conversation_memory FOR SELECT TO authenticated
  USING (
    app_user_role() = 'admin'
    OR (app_user_role() IN ('gestor', 'vendedor') AND store_id = app_user_store_id())
  );

ALTER TABLE transfer_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tl_read ON transfer_locks;
CREATE POLICY tl_read ON transfer_locks FOR SELECT TO authenticated
  USING (
    app_user_role() = 'admin'
    OR (app_user_role() IN ('gestor', 'vendedor') AND store_id = app_user_store_id())
  );

ALTER TABLE transfer_flow_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tfa_read ON transfer_flow_audit;
CREATE POLICY tfa_read ON transfer_flow_audit FOR SELECT TO authenticated
  USING (
    app_user_role() = 'admin'
    OR (app_user_role() IN ('gestor', 'vendedor') AND store_id = app_user_store_id())
  );
