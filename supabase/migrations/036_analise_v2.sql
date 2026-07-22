-- Análise de atendimento v2: nota geral (permite "melhor conversa da
-- semana" e evolução), taxonomia de objeções e desfecho mais preciso.
ALTER TABLE conversation_analysis ADD COLUMN IF NOT EXISTS nota_geral int;
ALTER TABLE conversation_analysis ADD COLUMN IF NOT EXISTS objecoes jsonb DEFAULT '[]'::jsonb;
ALTER TABLE conversation_analysis ADD COLUMN IF NOT EXISTS prompt_version int DEFAULT 1;

CREATE INDEX IF NOT EXISTS conv_analysis_nota_idx
  ON conversation_analysis (last_message_at DESC, nota_geral DESC);

-- Agregado por vendedora — v2 acrescenta nota média, objeções e erros
-- (DROP necessário: o tipo de retorno mudou em relação à v1)
DROP FUNCTION IF EXISTS vendor_quality_metrics(timestamptz, timestamptz);

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
      count(*) FILTER (WHERE a.desfecho = 'vendido')                  AS vendidos,
      count(*) FILTER (WHERE a.desfecho = 'esfriou')                  AS esfriados,
      ROUND(AVG(a.nota_geral), 1)                                     AS nota
    FROM a GROUP BY a.vendor_id
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
    COALESCE(agg.vendidos, 0),
    COALESCE(agg.esfriados, 0),
    COALESCE(prosp.iniciadas, 0),
    audio.pct,
    agg.nota,
    COALESCE(obj.total, 0),
    COALESCE(obj.quebradas, 0),
    COALESCE(err.total, 0)
  FROM vendors v
  LEFT JOIN agg   ON agg.vendor_id   = v.id
  LEFT JOIN prosp ON prosp.vendor_id = v.id
  LEFT JOIN audio ON audio.vendor_id = v.id
  LEFT JOIN obj   ON obj.vendor_id   = v.id
  LEFT JOIN err   ON err.vendor_id   = v.id
  WHERE v.active AND (agg.convs IS NOT NULL OR prosp.iniciadas IS NOT NULL OR audio.pct IS NOT NULL)
  ORDER BY v.store_id, v.queue_order;
$$;
