-- Agregados de destaque da aba Métricas (oportunidades perdidas e objeções)
CREATE OR REPLACE FUNCTION analysis_perdas(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(esfriados bigint, followup_perdidos bigint, negativas_secas bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    count(*) FILTER (WHERE desfecho IN ('esfriou', 'perdido')),
    count(*) FILTER (WHERE followup_oportunidade AND NOT followup_feito),
    count(*) FILTER (WHERE estoque_situacao = 'negativa_seca')
  FROM conversation_analysis
  WHERE last_message_at >= p_from AND last_message_at < p_to;
$$;

CREATE OR REPLACE FUNCTION analysis_objecoes(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(tipo text, total bigint, quebradas bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(o->>'tipo', 'outro') AS tipo,
    count(*) AS total,
    count(*) FILTER (WHERE (o->>'quebrada')::boolean) AS quebradas
  FROM conversation_analysis ca,
       jsonb_array_elements(COALESCE(ca.objecoes, '[]'::jsonb)) o
  WHERE ca.last_message_at >= p_from AND ca.last_message_at < p_to
  GROUP BY 1
  ORDER BY count(*) DESC;
$$;
