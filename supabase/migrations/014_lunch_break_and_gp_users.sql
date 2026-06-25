-- ============================================================
-- Migration 014: Horário de almoço por vendedor + usuários GP
-- ============================================================

-- -----------------------------------------------------------
-- 1. Adiciona colunas de almoço na tabela vendors
-- -----------------------------------------------------------
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS lunch_start TIME,
  ADD COLUMN IF NOT EXISTS lunch_end   TIME;

-- -----------------------------------------------------------
-- 2. Atualiza assign_next_vendor para pular vendedores no almoço
--    Fallback: se todos estiverem no almoço, usa lista completa
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_next_vendor(
  p_store_id INTEGER
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_all_vendors   TEXT[];
  v_avail_vendors TEXT[];
  v_current       TEXT;
  v_current_idx   INT;
  v_next_idx      INT;
  v_next          TEXT;
  v_now_time      TIME;
BEGIN
  -- Bloqueia a linha da fila para este store (evita race condition)
  SELECT current_vendor INTO v_current
  FROM   vendor_queue
  WHERE  store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Hora atual em São Paulo (UTC-3)
  v_now_time := (NOW() AT TIME ZONE 'America/Sao_Paulo')::TIME;

  -- Todos os vendedores na fila (com queue_order)
  SELECT array_agg(name ORDER BY queue_order) INTO v_all_vendors
  FROM   vendors
  WHERE  store_id    = p_store_id
    AND  active      = TRUE
    AND  queue_order IS NOT NULL;

  IF v_all_vendors IS NULL OR array_length(v_all_vendors, 1) = 0 THEN
    RETURN NULL;
  END IF;

  -- Vendedores disponíveis agora (fora do horário de almoço)
  SELECT array_agg(name ORDER BY queue_order) INTO v_avail_vendors
  FROM   vendors
  WHERE  store_id    = p_store_id
    AND  active      = TRUE
    AND  queue_order IS NOT NULL
    AND (
      lunch_start IS NULL
      OR lunch_end   IS NULL
      OR NOT (v_now_time >= lunch_start AND v_now_time < lunch_end)
    );

  -- Se todos estão no almoço, usa lista completa como fallback
  IF v_avail_vendors IS NULL OR array_length(v_avail_vendors, 1) = 0 THEN
    v_avail_vendors := v_all_vendors;
  END IF;

  -- Calcula próximo índice no conjunto disponível
  v_current_idx := array_position(v_avail_vendors, v_current);

  IF v_current_idx IS NULL THEN
    v_next_idx := 1;
  ELSE
    v_next_idx := (v_current_idx % array_length(v_avail_vendors, 1)) + 1;
  END IF;

  v_next := v_avail_vendors[v_next_idx];

  -- Atualiza a fila dentro da mesma transação
  UPDATE vendor_queue
  SET    current_vendor = v_next
  WHERE  store_id = p_store_id;

  RETURN v_next;
END;
$$;

-- -----------------------------------------------------------
-- 3. Perfis dos novos usuários (vendedoras da loja GP)
--    IDs gerados via Supabase Admin API
-- -----------------------------------------------------------
INSERT INTO app_users (id, email, name, is_admin, active, status)
VALUES
  ('675ac22c-75e4-4f3b-b713-77784d40e992', 'eduardabftecmazza@gmail.com',  'Maria Eduarda', false, true, 'approved'),
  ('b2a45fd5-cd6f-4517-af2e-9b5a5873aeb2', 'gabrielebftecmazza@gmail.com', 'Gabriele',      false, true, 'approved'),
  ('14686130-5141-447f-93e7-bc27680eaeef', 'maizabftecmazza@gmail.com',    'Maiza',         false, true, 'approved'),
  ('b4718c82-24cf-4431-8b19-bcfe43ebd5db', 'mellyssabftecmazza@gmail.com', 'Melyssa',       false, true, 'approved')
ON CONFLICT (id) DO UPDATE SET
  name   = EXCLUDED.name,
  status = 'approved',
  active = true;

-- -----------------------------------------------------------
-- 4. Vincula cada usuária à sua inbox de vendedora (loja GP)
-- -----------------------------------------------------------
INSERT INTO user_inboxes (user_id, inbox_id, can_send, can_manage)
SELECT
  u.user_id,
  i.id AS inbox_id,
  true  AS can_send,
  false AS can_manage
FROM (VALUES
  ('675ac22c-75e4-4f3b-b713-77784d40e992'::uuid, 'mariaeduardabfg'),
  ('b2a45fd5-cd6f-4517-af2e-9b5a5873aeb2'::uuid, 'gabrielebfg'),
  ('14686130-5141-447f-93e7-bc27680eaeef'::uuid, 'maizabfg'),
  ('b4718c82-24cf-4431-8b19-bcfe43ebd5db'::uuid, 'melyssabfg')
) AS u(user_id, session)
JOIN inboxes i ON i.waha_session = u.session
ON CONFLICT (user_id, inbox_id) DO NOTHING;
