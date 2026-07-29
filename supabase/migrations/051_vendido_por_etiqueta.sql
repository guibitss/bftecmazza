-- "Vendido" passa a ser a ETIQUETA aplicada pela vendedora (fonte da verdade),
-- não mais o palpite do agente (desfecho='vendido'). A vendedora marca a
-- etiqueta "vendido" na conversa ao fechar; a conversão e a coluna VENDIDOS
-- passam a contar isso. (O funil de campanhas — 030 — já usava a etiqueta.)
--
-- Atribuição: a venda é creditada ao vendedor da CAIXA da conversa
-- (conversations.inbox_id -> inboxes.vendor_id), no período por last_message_at.

-- ── Qualidade por vendedora: VENDIDOS = etiqueta "vendido" ────────────────────
CREATE OR REPLACE FUNCTION vendor_quality_metrics(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  vendor_id int, vendor_name text, store_id int,
  convs_analisadas bigint,
  fechamento_por_conv numeric,
  convs_sem_fechamento bigint,
  followup_oportunidades bigint,
  followup_feitos bigint,
  estoque_pontes bigint,
  estoque_negativas_secas bigint,
  parcelamento_proativo_pct numeric,
  qualificacao_pct numeric,
  vendidos bigint,
  esfriados bigint,
  prospeccao_ativa bigint,
  audio_pct numeric,
  nota_media numeric,
  objecoes_total bigint,
  objecoes_quebradas bigint,
  erros_total bigint
) LANGUAGE sql STABLE AS $$
  WITH a AS (
    SELECT * FROM conversation_analysis
    WHERE last_message_at >= p_from AND last_message_at < p_to AND vendor_id IS NOT NULL
      AND analisavel AND eh_atendimento
  ),
  obj AS (
    SELECT a.vendor_id,
      count(*) AS total,
      count(*) FILTER (WHERE (o->>'quebrada')::boolean) AS quebradas
    FROM a, jsonb_array_elements(COALESCE(a.objecoes, '[]'::jsonb)) o
    GROUP BY a.vendor_id
  ),
  err AS (
    SELECT a.vendor_id, count(*) AS total
    FROM a, jsonb_array_elements(COALESCE(a.erros, '[]'::jsonb)) e
    GROUP BY a.vendor_id
  ),
  agg AS (
    SELECT
      a.vendor_id,
      count(*)                                                        AS convs,
      ROUND(AVG(COALESCE(a.fechamento_count, 0)), 1)                  AS fech_media,
      count(*) FILTER (WHERE COALESCE(a.fechamento_count, 0) = 0)     AS sem_fech,
      count(*) FILTER (WHERE a.followup_oportunidade)                 AS fu_oport,
      count(*) FILTER (WHERE a.followup_oportunidade AND a.followup_feito) AS fu_feitos,
      count(*) FILTER (WHERE a.estoque_situacao = 'ponte')            AS est_ponte,
      count(*) FILTER (WHERE a.estoque_situacao = 'negativa_seca')    AS est_seca,
      ROUND(100.0 * count(*) FILTER (WHERE a.parcelamento_proativo)
        / NULLIF(count(*) FILTER (WHERE a.parcelamento_proativo IS NOT NULL), 0), 0) AS parc_pct,
      ROUND(100.0 * count(*) FILTER (WHERE a.qualificou_antes_preco)
        / NULLIF(count(*) FILTER (WHERE a.qualificou_antes_preco IS NOT NULL), 0), 0) AS qual_pct,
      count(*) FILTER (WHERE a.desfecho = 'esfriou')                  AS esfriados,
      ROUND(AVG(a.nota_geral), 1)                                     AS nota
    FROM a GROUP BY a.vendor_id
  ),
  -- VENDIDOS pela etiqueta "vendido", creditado ao vendedor da caixa
  vend AS (
    SELECT i.vendor_id, count(DISTINCT c.id) AS vendidos
    FROM conversation_labels cl
    JOIN labels l       ON l.id = cl.label_id AND lower(l.name) = 'vendido'
    JOIN conversations c ON c.id = cl.conversation_id
    JOIN inboxes i      ON i.id = c.inbox_id AND i.kind = 'vendor' AND i.vendor_id IS NOT NULL
    WHERE c.last_message_at >= p_from AND c.last_message_at < p_to
    GROUP BY i.vendor_id
  ),
  prosp AS (
    SELECT v.id AS vendor_id, count(DISTINCT m.conversation_id) AS iniciadas
    FROM messages m
    JOIN inboxes i ON i.id = m.inbox_id AND i.kind = 'vendor'
    JOIN vendors v ON v.id = i.vendor_id
    WHERE m.created_at >= p_from AND m.created_at < p_to
      AND m.direction = 'out'
      AND NOT EXISTS (
        SELECT 1 FROM messages m2
        WHERE m2.conversation_id = m.conversation_id AND m2.created_at < m.created_at
      )
    GROUP BY v.id
  ),
  audio AS (
    SELECT m.author_id AS vendor_id,
      ROUND(100.0 * count(*) FILTER (WHERE m.kind = 'audio') / NULLIF(count(*), 0), 0) AS pct
    FROM messages m
    WHERE m.created_at >= p_from AND m.created_at < p_to
      AND m.author_type = 'vendor' AND m.direction = 'out' AND m.author_id IS NOT NULL
    GROUP BY m.author_id
  )
  SELECT
    v.id, v.name, v.store_id,
    COALESCE(agg.convs, 0),
    agg.fech_media,
    COALESCE(agg.sem_fech, 0),
    COALESCE(agg.fu_oport, 0),
    COALESCE(agg.fu_feitos, 0),
    COALESCE(agg.est_ponte, 0),
    COALESCE(agg.est_seca, 0),
    agg.parc_pct,
    agg.qual_pct,
    COALESCE(vend.vendidos, 0),
    COALESCE(agg.esfriados, 0),
    COALESCE(prosp.iniciadas, 0),
    audio.pct,
    agg.nota,
    COALESCE(obj.total, 0),
    COALESCE(obj.quebradas, 0),
    COALESCE(err.total, 0)
  FROM vendors v
  LEFT JOIN agg   ON agg.vendor_id   = v.id
  LEFT JOIN vend  ON vend.vendor_id  = v.id
  LEFT JOIN prosp ON prosp.vendor_id = v.id
  LEFT JOIN audio ON audio.vendor_id = v.id
  LEFT JOIN obj   ON obj.vendor_id   = v.id
  LEFT JOIN err   ON err.vendor_id   = v.id
  WHERE v.active AND (agg.convs IS NOT NULL OR prosp.iniciadas IS NOT NULL OR audio.pct IS NOT NULL OR vend.vendidos IS NOT NULL)
  ORDER BY v.store_id, v.queue_order;
$$;

-- ── Valor em risco / conversão por loja: vendidos = etiqueta "vendido" ─────────
CREATE OR REPLACE FUNCTION analysis_valor_risco(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  store_id int, slug text, ticket_medio numeric,
  followup_perdidos bigint, esfriados bigint,
  conversao_pct numeric, valor_risco numeric
) LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT ca.store_id,
      count(*) AS analisadas,
      count(*) FILTER (WHERE ca.followup_oportunidade AND NOT ca.followup_feito) AS fu_perdidos,
      count(*) FILTER (WHERE ca.desfecho IN ('esfriou', 'perdido')) AS esfriados
    FROM conversation_analysis ca
    WHERE ca.analisavel AND ca.eh_atendimento
      AND ca.last_message_at >= p_from AND ca.last_message_at < p_to
    GROUP BY ca.store_id
  ),
  -- vendidos = etiqueta "vendido" por loja
  vend AS (
    SELECT c.store_id, count(DISTINCT c.id) AS vendidos
    FROM conversation_labels cl
    JOIN labels l        ON l.id = cl.label_id AND lower(l.name) = 'vendido'
    JOIN conversations c ON c.id = cl.conversation_id
    WHERE c.last_message_at >= p_from AND c.last_message_at < p_to
    GROUP BY c.store_id
  )
  SELECT s.id, s.slug, s.ticket_medio, b.fu_perdidos, b.esfriados,
    ROUND(100.0 * COALESCE(vd.vendidos, 0) / NULLIF(b.analisadas, 0), 1),
    ROUND(b.fu_perdidos * COALESCE(s.ticket_medio, 0)
          * (COALESCE(vd.vendidos, 0)::numeric / NULLIF(b.analisadas, 0)), 0)
  FROM base b
  JOIN stores s ON s.id = b.store_id
  LEFT JOIN vend vd ON vd.store_id = b.store_id
  ORDER BY 7 DESC NULLS LAST;
$$;
