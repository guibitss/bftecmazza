-- Ticket médio por loja + cálculo de "valor em risco" das oportunidades
-- não trabalhadas. Metodologia conservadora: usa a taxa de conversão
-- OBSERVADA da própria loja, não assume que todo lead viraria venda.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS ticket_medio numeric;

UPDATE stores SET ticket_medio = 8000 WHERE slug = 'bftecmazza';
UPDATE stores SET ticket_medio = 7500 WHERE slug = 'gp';
UPDATE stores SET ticket_medio = 5000 WHERE slug = 'xmazza';

CREATE OR REPLACE FUNCTION analysis_valor_risco(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  store_id int, slug text, ticket_medio numeric,
  followup_perdidos bigint, esfriados bigint,
  conversao_pct numeric, valor_risco numeric
) LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      ca.store_id,
      count(*)                                                        AS analisadas,
      count(*) FILTER (WHERE ca.desfecho = 'vendido')                 AS vendidos,
      count(*) FILTER (WHERE ca.followup_oportunidade AND NOT ca.followup_feito) AS fu_perdidos,
      count(*) FILTER (WHERE ca.desfecho IN ('esfriou', 'perdido'))   AS esfriados
    FROM conversation_analysis ca
    WHERE ca.analisavel AND ca.last_message_at >= p_from AND ca.last_message_at < p_to
    GROUP BY ca.store_id
  )
  SELECT
    s.id, s.slug, s.ticket_medio,
    b.fu_perdidos, b.esfriados,
    ROUND(100.0 * b.vendidos / NULLIF(b.analisadas, 0), 1) AS conversao_pct,
    ROUND(b.fu_perdidos * COALESCE(s.ticket_medio, 0)
          * (b.vendidos::numeric / NULLIF(b.analisadas, 0)), 0) AS valor_risco
  FROM base b
  JOIN stores s ON s.id = b.store_id
  ORDER BY 7 DESC NULLS LAST;
$$;
