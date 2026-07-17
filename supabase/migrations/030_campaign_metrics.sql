-- Métricas de campanha (Meta Ads → CRM)
-- Gasto diário por campanha sincronizado da Graph API (meta-ads-sync)
CREATE TABLE IF NOT EXISTS ad_campaign_spend (
  campaign_id   text NOT NULL,
  date          date NOT NULL,
  campaign_name text,
  account_id    text,
  spend         numeric NOT NULL DEFAULT 0,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, date)
);
ALTER TABLE ad_campaign_spend ENABLE ROW LEVEL SECURITY;

-- Etiqueta "vendido" (geral) em todas as lojas ativas — vendedora marca ao fechar
INSERT INTO labels (store_id, name, color)
SELECT s.id, 'vendido', '#22c55e'
FROM stores s
WHERE s.active
  AND NOT EXISTS (
    SELECT 1 FROM labels l WHERE l.store_id = s.id AND lower(l.name) = 'vendido'
  );

-- Funil por campanha: leads → vendidos → conversão, com gasto do período
CREATE OR REPLACE FUNCTION campaign_metrics(p_days int DEFAULT 30)
RETURNS TABLE(
  campaign_id text, campaign_name text, leads bigint, vendas bigint,
  conversao numeric, gasto numeric, custo_lead numeric, custo_venda numeric
) LANGUAGE sql STABLE AS $$
  WITH leads AS (
    SELECT c.id, c.store_id,
           COALESCE(c.customer_phone, c.waha_id) AS cust,
           COALESCE(c.ad_campaign_id, 'nao_resolvido') AS camp_id,
           COALESCE(c.ad_campaign_name, c.ad_headline, 'Campanha não resolvida') AS camp_name
    FROM conversations c
    WHERE c.ad_source_id IS NOT NULL
      AND c.first_message_at >= now() - (p_days || ' days')::interval
  ),
  vendidos AS (
    SELECT DISTINCT c2.store_id, COALESCE(c2.customer_phone, c2.waha_id) AS cust
    FROM conversation_labels cl
    JOIN labels l ON l.id = cl.label_id AND lower(l.name) = 'vendido'
    JOIN conversations c2 ON c2.id = cl.conversation_id
  ),
  spend AS (
    SELECT s.campaign_id, SUM(s.spend) AS gasto
    FROM ad_campaign_spend s
    WHERE s.date >= (now() - (p_days || ' days')::interval)::date
    GROUP BY s.campaign_id
  )
  SELECT
    l.camp_id,
    max(l.camp_name),
    count(*) AS leads,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM vendidos v WHERE v.cust = l.cust AND v.store_id = l.store_id
    )) AS vendas,
    ROUND(100.0 * count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM vendidos v WHERE v.cust = l.cust AND v.store_id = l.store_id
    )) / count(*), 1) AS conversao,
    sp.gasto,
    ROUND(sp.gasto / NULLIF(count(*), 0), 2) AS custo_lead,
    ROUND(sp.gasto / NULLIF(count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM vendidos v WHERE v.cust = l.cust AND v.store_id = l.store_id
    )), 0), 2) AS custo_venda
  FROM leads l
  LEFT JOIN spend sp ON sp.campaign_id = l.camp_id
  GROUP BY l.camp_id, sp.gasto
  ORDER BY count(*) DESC;
$$;
