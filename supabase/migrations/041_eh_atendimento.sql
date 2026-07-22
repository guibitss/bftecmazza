-- As caixas das vendedoras recebem TUDO do WhatsApp delas, inclusive
-- conversas pessoais (amigos, família, assuntos particulares). Elas
-- estavam entrando nas métricas e até ganhando "melhor atendimento".
-- O agente passa a classificar e as não-atendimento saem dos agregados.
ALTER TABLE conversation_analysis
  ADD COLUMN IF NOT EXISTS eh_atendimento boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION analysis_perdas(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(esfriados bigint, followup_perdidos bigint, negativas_secas bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    count(*) FILTER (WHERE desfecho IN ('esfriou', 'perdido')),
    count(*) FILTER (WHERE followup_oportunidade AND NOT followup_feito),
    count(*) FILTER (WHERE estoque_situacao = 'negativa_seca')
  FROM conversation_analysis
  WHERE last_message_at >= p_from AND last_message_at < p_to
    AND analisavel AND eh_atendimento;
$$;

DROP FUNCTION IF EXISTS analysis_objecoes(timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION analysis_objecoes(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(tipo text, total bigint, avaliaveis bigint, quebradas bigint, indeterminadas bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(o->>'tipo', 'outro') AS tipo,
    count(*) AS total,
    count(*) FILTER (WHERE o->>'quebrada' IS NOT NULL AND o->>'quebrada' <> 'null'),
    count(*) FILTER (WHERE (o->>'quebrada') = 'true'),
    count(*) FILTER (WHERE o->>'quebrada' IS NULL OR o->>'quebrada' = 'null')
  FROM conversation_analysis ca,
       jsonb_array_elements(COALESCE(ca.objecoes, '[]'::jsonb)) o
  WHERE ca.last_message_at >= p_from AND ca.last_message_at < p_to
    AND ca.analisavel AND ca.eh_atendimento
  GROUP BY 1
  ORDER BY count(*) DESC;
$$;

CREATE OR REPLACE FUNCTION analysis_valor_risco(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  store_id int, slug text, ticket_medio numeric,
  followup_perdidos bigint, esfriados bigint,
  conversao_pct numeric, valor_risco numeric
) LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT ca.store_id,
      count(*) AS analisadas,
      count(*) FILTER (WHERE ca.desfecho = 'vendido') AS vendidos,
      count(*) FILTER (WHERE ca.followup_oportunidade AND NOT ca.followup_feito) AS fu_perdidos,
      count(*) FILTER (WHERE ca.desfecho IN ('esfriou', 'perdido')) AS esfriados
    FROM conversation_analysis ca
    WHERE ca.analisavel AND ca.eh_atendimento
      AND ca.last_message_at >= p_from AND ca.last_message_at < p_to
    GROUP BY ca.store_id
  )
  SELECT s.id, s.slug, s.ticket_medio, b.fu_perdidos, b.esfriados,
    ROUND(100.0 * b.vendidos / NULLIF(b.analisadas, 0), 1),
    ROUND(b.fu_perdidos * COALESCE(s.ticket_medio, 0)
          * (b.vendidos::numeric / NULLIF(b.analisadas, 0)), 0)
  FROM base b JOIN stores s ON s.id = b.store_id
  ORDER BY 7 DESC NULLS LAST;
$$;
