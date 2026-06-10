-- Colunas adicionais para o fluxo de aprovação de usuários
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by        UUID REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_of_store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL;
