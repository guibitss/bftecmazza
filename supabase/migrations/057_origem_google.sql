-- Lead vindo do Google: chega com a mensagem padrão do anúncio
-- ("Olá! Vim pelo Google e quero um orçamento"). Passa a receber a etiqueta
-- "google" automaticamente e a contar como origem no painel.
--
-- Feito por trigger no banco (e não numa edge function) pra valer em qualquer
-- caminho de ingestão — waha-webhook, chatwoot-webhook ou importação.

-- 1) Etiqueta "google" em toda loja ativa que ainda não tem
INSERT INTO labels (store_id, name, color)
SELECT s.id, 'google', '#4285F4'
FROM stores s
WHERE s.active
  AND NOT EXISTS (
    SELECT 1 FROM labels l WHERE l.store_id = s.id AND lower(l.name) = 'google'
  );

-- 2) Aplica a etiqueta quando a mensagem do anúncio chega
CREATE OR REPLACE FUNCTION tag_google_lead()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_label uuid;
BEGIN
  -- Só mensagem recebida do cliente com a frase do anúncio
  IF NEW.direction <> 'in' OR NEW.body IS NULL THEN
    RETURN NEW;
  END IF;
  IF position('vim pelo google' in lower(NEW.body)) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT l.id INTO v_label
  FROM labels l
  WHERE l.store_id = NEW.store_id AND lower(l.name) = 'google'
  LIMIT 1;

  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO conversation_labels (conversation_id, label_id)
  VALUES (NEW.conversation_id, v_label)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tag_google_lead ON messages;
CREATE TRIGGER trg_tag_google_lead
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION tag_google_lead();

-- 3) Backfill: etiqueta as conversas que já chegaram pelo Google
INSERT INTO conversation_labels (conversation_id, label_id)
SELECT DISTINCT m.conversation_id, l.id
FROM messages m
JOIN labels l ON l.store_id = m.store_id AND lower(l.name) = 'google'
WHERE m.direction = 'in'
  AND position('vim pelo google' in lower(coalesce(m.body, ''))) > 0
ON CONFLICT DO NOTHING;

-- 4) Origem dos leads no período: Google x Meta Ads x demais
CREATE OR REPLACE FUNCTION analysis_origem(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(origem text, leads bigint, vendidos bigint, conversao numeric)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      c.id,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM conversation_labels cl
          JOIN labels l ON l.id = cl.label_id AND lower(l.name) = 'google'
          WHERE cl.conversation_id = c.id
        ) THEN 'Google'
        WHEN c.ad_campaign_id IS NOT NULL OR c.ad_ctwa_clid IS NOT NULL THEN 'Meta Ads'
        ELSE 'Orgânico / outros'
      END AS origem,
      EXISTS (
        SELECT 1 FROM conversation_labels cl2
        JOIN labels l2 ON l2.id = cl2.label_id AND lower(l2.name) = 'vendido'
        WHERE cl2.conversation_id = c.id
      ) AS vendido
    FROM conversations c
    WHERE c.first_message_at >= p_from AND c.first_message_at < p_to
  )
  SELECT
    origem,
    count(*)                                   AS leads,
    count(*) FILTER (WHERE vendido)            AS vendidos,
    ROUND(100.0 * count(*) FILTER (WHERE vendido) / NULLIF(count(*), 0), 1) AS conversao
  FROM base
  GROUP BY origem
  ORDER BY leads DESC;
$$;
