-- Objeções: "quebrada" agora aceita indeterminado (null) quando a resposta
-- da vendedora veio em áudio/mídia. Contar isso como falha penalizava
-- sistematicamente quem negocia por áudio (10,8% das mensagens).
DROP FUNCTION IF EXISTS analysis_objecoes(timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION analysis_objecoes(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(tipo text, total bigint, avaliaveis bigint, quebradas bigint, indeterminadas bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(o->>'tipo', 'outro') AS tipo,
    count(*) AS total,
    count(*) FILTER (WHERE o->>'quebrada' IS NOT NULL AND o->>'quebrada' <> 'null') AS avaliaveis,
    count(*) FILTER (WHERE (o->>'quebrada') = 'true') AS quebradas,
    count(*) FILTER (WHERE o->>'quebrada' IS NULL OR o->>'quebrada' = 'null') AS indeterminadas
  FROM conversation_analysis ca,
       jsonb_array_elements(COALESCE(ca.objecoes, '[]'::jsonb)) o
  WHERE ca.last_message_at >= p_from AND ca.last_message_at < p_to AND ca.analisavel
  GROUP BY 1
  ORDER BY count(*) DESC;
$$;

-- Agregado por vendedora: objecoes_total passa a ser o avaliável
CREATE OR REPLACE FUNCTION vendor_objecoes(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(vendor_id int, avaliaveis bigint, quebradas bigint, indeterminadas bigint)
LANGUAGE sql STABLE AS $$
  SELECT ca.vendor_id,
    count(*) FILTER (WHERE o->>'quebrada' IS NOT NULL AND o->>'quebrada' <> 'null'),
    count(*) FILTER (WHERE (o->>'quebrada') = 'true'),
    count(*) FILTER (WHERE o->>'quebrada' IS NULL OR o->>'quebrada' = 'null')
  FROM conversation_analysis ca,
       jsonb_array_elements(COALESCE(ca.objecoes, '[]'::jsonb)) o
  WHERE ca.last_message_at >= p_from AND ca.last_message_at < p_to
    AND ca.analisavel AND ca.vendor_id IS NOT NULL
  GROUP BY ca.vendor_id;
$$;
