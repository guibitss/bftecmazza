-- analysis_conversas: filtro por sugestão REAL do agente (regex), pra o "ver"
-- da sugestão trazer exatamente as conversas onde ela foi feita (não todas).
DROP FUNCTION IF EXISTS analysis_conversas(text, timestamptz, timestamptz, int, int);

CREATE OR REPLACE FUNCTION analysis_conversas(
  p_tipo text, p_from timestamptz, p_to timestamptz,
  p_vendor int DEFAULT NULL, p_store int DEFAULT NULL, p_sug_regex text DEFAULT NULL
)
RETURNS TABLE(
  conversation_id int, inbox_id int, vendor_id int, vendor_name text,
  customer_name text, last_message_at timestamptz,
  nota_geral int, desfecho text, preview text, sugestao text
) LANGUAGE sql STABLE AS $$
  SELECT
    ca.conversation_id, c.inbox_id::int, ca.vendor_id, v.name,
    COALESCE(c.customer_name, c.customer_phone, 'Cliente'),
    ca.last_message_at, ca.nota_geral, ca.desfecho,
    c.last_message_preview,
    (ca.sugestoes->>0)
  FROM conversation_analysis ca
  JOIN vendors v ON v.id = ca.vendor_id
  LEFT JOIN conversations c ON c.id = ca.conversation_id
  WHERE ca.analisavel AND ca.eh_atendimento
    AND ca.last_message_at >= p_from AND ca.last_message_at < p_to
    AND (p_vendor IS NULL OR ca.vendor_id = p_vendor)
    AND (p_store IS NULL OR ca.store_id = p_store)
    AND (
      p_tipo = 'todas'
      OR (p_tipo = 'sugestao' AND p_sug_regex IS NOT NULL AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(COALESCE(ca.sugestoes,'[]'::jsonb)) x
            WHERE x ~* p_sug_regex))
      OR (p_tipo = 'sem_fechamento'   AND COALESCE(ca.fechamento_count,0) = 0)
      OR (p_tipo = 'followup_perdido' AND ca.followup_oportunidade AND NOT ca.followup_feito)
      OR (p_tipo = 'negativa_seca'  AND ca.estoque_situacao = 'negativa_seca')
      OR (p_tipo = 'esfriou'        AND ca.desfecho IN ('esfriou','perdido'))
      OR (p_tipo LIKE 'objecao_%'   AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(ca.objecoes,'[]'::jsonb)) o
            WHERE o->>'tipo' = substring(p_tipo from 9)
              AND COALESCE(o->>'quebrada','false') <> 'true'))
    )
  ORDER BY ca.last_message_at DESC
  LIMIT 300;
$$;
