-- Conversas curtas (< 3 mensagens) não têm o que analisar. Antes eram
-- puladas sem marcação e voltavam na fila em todo lote, entupindo o
-- backfill. Agora recebem um registro marcado analisavel=false, saem da
-- fila e ficam fora dos agregados.
ALTER TABLE conversation_analysis
  ADD COLUMN IF NOT EXISTS analisavel boolean NOT NULL DEFAULT true;

-- Agregados passam a considerar só conversas efetivamente analisadas
CREATE OR REPLACE FUNCTION analysis_perdas(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(esfriados bigint, followup_perdidos bigint, negativas_secas bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    count(*) FILTER (WHERE desfecho IN ('esfriou', 'perdido')),
    count(*) FILTER (WHERE followup_oportunidade AND NOT followup_feito),
    count(*) FILTER (WHERE estoque_situacao = 'negativa_seca')
  FROM conversation_analysis
  WHERE last_message_at >= p_from AND last_message_at < p_to AND analisavel;
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
  WHERE ca.last_message_at >= p_from AND ca.last_message_at < p_to AND ca.analisavel
  GROUP BY 1
  ORDER BY count(*) DESC;
$$;
