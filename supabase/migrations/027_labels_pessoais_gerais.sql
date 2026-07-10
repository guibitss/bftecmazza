-- Etiquetas em 2 tipos: gerais (owner_user_id NULL, compartilhadas da loja)
-- e pessoais (owner_user_id preenchido, visíveis só pro dono).
-- Acesso liberado pra todos os usuários com acesso à loja (antes: só admin/gerente).

ALTER TABLE labels ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES app_users(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS labels_select ON labels;
DROP POLICY IF EXISTS labels_manage ON labels;

-- Ver: gerais da loja + as próprias pessoais
CREATE POLICY labels_select ON labels FOR SELECT USING (
  user_can_access_store(store_id)
  AND (owner_user_id IS NULL OR owner_user_id = (SELECT auth.uid()))
);

-- Criar: qualquer um com acesso à loja; pessoal só em nome próprio
CREATE POLICY labels_insert ON labels FOR INSERT WITH CHECK (
  user_can_access_store(store_id)
  AND (owner_user_id IS NULL OR owner_user_id = (SELECT auth.uid()))
);

-- Editar/excluir: gerais → qualquer um da loja; pessoais → só o dono
CREATE POLICY labels_update ON labels FOR UPDATE USING (
  user_can_access_store(store_id)
  AND (owner_user_id IS NULL OR owner_user_id = (SELECT auth.uid()))
);

CREATE POLICY labels_delete ON labels FOR DELETE USING (
  user_can_access_store(store_id)
  AND (owner_user_id IS NULL OR owner_user_id = (SELECT auth.uid()))
);
