-- ============================================================
-- Adiciona colunas de status de aprovação + policy de auto-insert
-- ============================================================

-- 1. Colunas de status de aprovação
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS status       TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Usuários já existentes foram aprovados manualmente — marca como approved
UPDATE app_users SET status = 'approved' WHERE status = 'pending';

-- 2. RLS: permite novo usuário inserir o próprio perfil após criar conta
--    (sem essa policy o signup retorna erro de permissão)
DROP POLICY IF EXISTS app_users_self_insert ON app_users;
CREATE POLICY app_users_self_insert ON app_users
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- 3. Bloqueia login de usuários pendentes ou rejeitados
--    (a leitura do próprio perfil já era permitida pela app_users_self SELECT)
