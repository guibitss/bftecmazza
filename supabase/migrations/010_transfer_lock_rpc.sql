-- ============================================================
-- Migration 010: RPCs atômicas para transfer lock e vendor queue
-- ============================================================
--
-- PENDENTE: preencher summary_chat da Maiza (Loja 3 - Guarapuava).
-- Quando tiver o número, execute no SQL Editor do Supabase:
--
--   UPDATE vendors
--   SET summary_chat = '5542XXXXXXXXX@c.us'   -- substitua pelo número real
--   WHERE store_id = 3 AND name = 'maiza';
--
-- ============================================================

-- -------------------------------------------------------
-- 1. acquire_transfer_lock
--    Adquire lock idempotente por source_id + store_id.
--    Retorna TRUE se o lock foi adquirido (novo ou expirado).
--    Retorna FALSE se já existe lock válido (duplicata).
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION acquire_transfer_lock(
  p_source_id   TEXT,
  p_store_id    INTEGER,
  p_ttl_seconds INTEGER DEFAULT 300
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Remove lock expirado para este source_id (se houver)
  DELETE FROM transfer_locks
  WHERE source_id = p_source_id
    AND expires_at < NOW();

  -- Tenta inserir novo lock atomicamente
  INSERT INTO transfer_locks (source_id, store_id, created_at, expires_at)
  VALUES (
    p_source_id,
    p_store_id,
    NOW(),
    NOW() + (p_ttl_seconds || ' seconds')::INTERVAL
  )
  ON CONFLICT (source_id) DO NOTHING;

  -- FOUND é TRUE somente se o INSERT inseriu uma linha
  RETURN FOUND;
END;
$$;

-- -------------------------------------------------------
-- 2. assign_next_vendor
--    Seleciona o próximo vendedor na fila round-robin,
--    atualiza vendor_queue ATOMICAMENTE (SELECT FOR UPDATE),
--    prevenindo race condition entre chamadas concorrentes.
--    Retorna o nome do vendedor selecionado, ou NULL se
--    não houver vendedores ativos com queue_order.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_next_vendor(
  p_store_id INTEGER
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_vendors    TEXT[];
  v_current    TEXT;
  v_current_idx INT;
  v_next_idx   INT;
  v_next       TEXT;
BEGIN
  -- Bloqueia a linha da fila para este store (evita race condition)
  SELECT current_vendor INTO v_current
  FROM   vendor_queue
  WHERE  store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Busca vendedores ativos da fila, ordenados por queue_order
  SELECT array_agg(name ORDER BY queue_order) INTO v_vendors
  FROM   vendors
  WHERE  store_id    = p_store_id
    AND  active      = TRUE
    AND  queue_order IS NOT NULL;

  IF v_vendors IS NULL OR array_length(v_vendors, 1) = 0 THEN
    RETURN NULL;
  END IF;

  -- Calcula próximo índice (1-based em arrays PG)
  v_current_idx := array_position(v_vendors, v_current);

  IF v_current_idx IS NULL THEN
    v_next_idx := 1;
  ELSE
    v_next_idx := (v_current_idx % array_length(v_vendors, 1)) + 1;
  END IF;

  v_next := v_vendors[v_next_idx];

  -- Atualiza a fila dentro da mesma transação (lock ainda ativo)
  UPDATE vendor_queue
  SET    current_vendor = v_next
  WHERE  store_id = p_store_id;

  RETURN v_next;
END;
$$;
