-- Filtros de período (dia/semana/mês/personalizado) para métricas
-- Versões com intervalo de datas das funções de métricas

CREATE OR REPLACE FUNCTION public.store_vendor_metrics_range(
  p_store_id integer, p_from timestamptz, p_to timestamptz
)
 RETURNS TABLE(vendor_id integer, vendor_name text, in_hours_avg_secs numeric, in_hours_count bigint, off_hours_avg_secs numeric, off_hours_count bigint, contacts bigint, msgs_per_contact numeric)
 LANGUAGE sql STABLE
AS $function$
  WITH msgs AS (
    SELECT m.conversation_id, m.created_at, m.direction, m.author_type, m.author_id
    FROM messages m
    WHERE m.store_id = p_store_id
      AND m.created_at >= p_from - INTERVAL '1 day'
      AND m.created_at <= p_to
  ),
  seq AS (
    SELECT conversation_id, created_at, direction, author_type, author_id,
      MAX(CASE WHEN direction = 'in' THEN created_at END)
        OVER (PARTITION BY conversation_id ORDER BY created_at
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS in_at
    FROM msgs
  ),
  pairs AS (
    SELECT author_id AS vid, in_at, created_at AS out_at
    FROM seq
    WHERE author_type = 'vendor' AND direction = 'out'
      AND created_at >= p_from
      AND in_at IS NOT NULL
      AND created_at - in_at <= INTERVAL '24 hours'
  ),
  firsts AS (
    SELECT DISTINCT ON (vid, in_at) vid, in_at, out_at
    FROM pairs ORDER BY vid, in_at, out_at
  ),
  resp AS (
    SELECT vid,
      ROUND(AVG(EXTRACT(EPOCH FROM (out_at - in_at))) FILTER (WHERE is_business_hour(in_at))::NUMERIC, 1)      AS in_avg,
      COUNT(*) FILTER (WHERE is_business_hour(in_at))                                                          AS in_cnt,
      ROUND(AVG(EXTRACT(EPOCH FROM (out_at - in_at))) FILTER (WHERE NOT is_business_hour(in_at))::NUMERIC, 1)  AS off_avg,
      COUNT(*) FILTER (WHERE NOT is_business_hour(in_at))                                                      AS off_cnt
    FROM firsts GROUP BY vid
  ),
  vconvs AS (
    SELECT DISTINCT author_id AS vid, conversation_id
    FROM msgs
    WHERE author_type = 'vendor' AND created_at >= p_from
  ),
  vol AS (
    SELECT vc.vid,
      COUNT(DISTINCT vc.conversation_id) AS contacts,
      COUNT(*) AS total_msgs
    FROM vconvs vc
    JOIN msgs m ON m.conversation_id = vc.conversation_id
    WHERE m.created_at >= p_from
    GROUP BY vc.vid
  )
  SELECT v.id, v.name,
    r.in_avg, COALESCE(r.in_cnt, 0), r.off_avg, COALESCE(r.off_cnt, 0),
    COALESCE(vo.contacts, 0),
    ROUND(vo.total_msgs::NUMERIC / NULLIF(vo.contacts, 0), 1)
  FROM vendors v
  LEFT JOIN resp r ON r.vid = v.id
  LEFT JOIN vol vo ON vo.vid = v.id
  WHERE v.store_id = p_store_id
  ORDER BY v.queue_order;
$function$;

CREATE OR REPLACE FUNCTION public.campaign_metrics_range(p_from timestamptz, p_to timestamptz)
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
      AND c.first_message_at BETWEEN p_from AND p_to
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
    WHERE s.date BETWEEN p_from::date AND p_to::date
    GROUP BY s.campaign_id
  )
  SELECT
    l.camp_id, max(l.camp_name), count(*) AS leads,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM vendidos v WHERE v.cust = l.cust AND v.store_id = l.store_id)) AS vendas,
    ROUND(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM vendidos v WHERE v.cust = l.cust AND v.store_id = l.store_id)) / count(*), 1),
    sp.gasto,
    ROUND(sp.gasto / NULLIF(count(*), 0), 2),
    ROUND(sp.gasto / NULLIF(count(*) FILTER (WHERE EXISTS (SELECT 1 FROM vendidos v WHERE v.cust = l.cust AND v.store_id = l.store_id)), 0), 2)
  FROM leads l
  LEFT JOIN spend sp ON sp.campaign_id = l.camp_id
  GROUP BY l.camp_id, sp.gasto
  ORDER BY count(*) DESC;
$$;
