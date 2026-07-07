-- Métricas de vendedores: versão set-based + cache pré-computado
-- (já aplicado em produção via Management API em 2026-07-07)
--
-- Antes: store_vendor_metrics fazia 3 sub-funções LATERAL por vendedor,
-- cada uma com seq scan/subconsulta correlacionada em messages → 3-18s
-- por loja e timeouts intermitentes no dashboard ("Sem dados no período").
-- Agora: uma única passada por loja (v2, validada linha a linha contra a
-- original) + cache em vendor_metrics_cache atualizado a cada 5 min.

CREATE OR REPLACE FUNCTION public.store_vendor_metrics_v2(p_store_id integer, p_days integer DEFAULT 30)
 RETURNS TABLE(vendor_id integer, vendor_name text, in_hours_avg_secs numeric, in_hours_count bigint, off_hours_avg_secs numeric, off_hours_count bigint, contacts bigint, msgs_per_contact numeric)
 LANGUAGE sql
 STABLE
AS $function$
  -- Uma única passada nas mensagens da loja (margem de 1 dia pro pareamento ≤24h)
  WITH msgs AS (
    SELECT m.conversation_id, m.created_at, m.direction, m.author_type, m.author_id
    FROM messages m
    WHERE m.store_id = p_store_id
      AND m.created_at >= NOW() - (p_days || ' days')::INTERVAL - INTERVAL '1 day'
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
      AND created_at >= NOW() - (p_days || ' days')::INTERVAL
      AND in_at IS NOT NULL
      AND created_at - in_at <= INTERVAL '24 hours'
  ),
  firsts AS (
    SELECT DISTINCT ON (vid, in_at) vid, in_at, out_at
    FROM pairs
    ORDER BY vid, in_at, out_at
  ),
  resp AS (
    SELECT vid,
      ROUND(AVG(EXTRACT(EPOCH FROM (out_at - in_at))) FILTER (WHERE is_business_hour(in_at))::NUMERIC, 1)      AS in_avg,
      COUNT(*) FILTER (WHERE is_business_hour(in_at))                                                          AS in_cnt,
      ROUND(AVG(EXTRACT(EPOCH FROM (out_at - in_at))) FILTER (WHERE NOT is_business_hour(in_at))::NUMERIC, 1)  AS off_avg,
      COUNT(*) FILTER (WHERE NOT is_business_hour(in_at))                                                      AS off_cnt
    FROM firsts
    GROUP BY vid
  ),
  vconvs AS (
    SELECT DISTINCT author_id AS vid, conversation_id
    FROM msgs
    WHERE author_type = 'vendor'
      AND created_at >= NOW() - (p_days || ' days')::INTERVAL
  ),
  vol AS (
    SELECT vc.vid,
      COUNT(DISTINCT vc.conversation_id) AS contacts,
      COUNT(*)                           AS total_msgs
    FROM vconvs vc
    JOIN msgs m ON m.conversation_id = vc.conversation_id
    WHERE m.created_at >= NOW() - (p_days || ' days')::INTERVAL
    GROUP BY vc.vid
  )
  SELECT v.id, v.name,
    r.in_avg,
    COALESCE(r.in_cnt, 0),
    r.off_avg,
    COALESCE(r.off_cnt, 0),
    COALESCE(vo.contacts, 0),
    ROUND(vo.total_msgs::NUMERIC / NULLIF(vo.contacts, 0), 1)
  FROM vendors v
  LEFT JOIN resp r ON r.vid = v.id
  LEFT JOIN vol vo ON vo.vid = v.id
  WHERE v.store_id = p_store_id
  ORDER BY v.queue_order;
$function$;

CREATE TABLE IF NOT EXISTS vendor_metrics_cache (
  store_id    int PRIMARY KEY REFERENCES stores(id),
  computed_at timestamptz NOT NULL DEFAULT now(),
  data        jsonb NOT NULL
);
ALTER TABLE vendor_metrics_cache ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION refresh_vendor_metrics_cache() RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO vendor_metrics_cache (store_id, computed_at, data)
  SELECT s.id, now(),
         COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM store_vendor_metrics_v2(s.id, 30) m), '[]'::jsonb)
  FROM stores s WHERE s.active
  ON CONFLICT (store_id) DO UPDATE
    SET computed_at = EXCLUDED.computed_at, data = EXCLUDED.data;
$$;

CREATE OR REPLACE FUNCTION public.store_vendor_metrics(p_store_id integer, p_days integer DEFAULT 30)
 RETURNS TABLE(vendor_id integer, vendor_name text, in_hours_avg_secs numeric, in_hours_count bigint, off_hours_avg_secs numeric, off_hours_count bigint, contacts bigint, msgs_per_contact numeric)
 LANGUAGE plpgsql STABLE AS $function$
BEGIN
  IF p_days = 30 AND EXISTS (
    SELECT 1 FROM vendor_metrics_cache c
    WHERE c.store_id = p_store_id AND c.computed_at > now() - interval '15 minutes'
  ) THEN
    RETURN QUERY
      SELECT (e->>'vendor_id')::int, e->>'vendor_name',
             (e->>'in_hours_avg_secs')::numeric, (e->>'in_hours_count')::bigint,
             (e->>'off_hours_avg_secs')::numeric, (e->>'off_hours_count')::bigint,
             (e->>'contacts')::bigint, (e->>'msgs_per_contact')::numeric
      FROM vendor_metrics_cache c, jsonb_array_elements(c.data) e
      WHERE c.store_id = p_store_id;
  ELSE
    RETURN QUERY SELECT * FROM store_vendor_metrics_v2(p_store_id, p_days);
  END IF;
END $function$;

-- Job de refresh (statement ÚNICO — pg_cron envolve comandos multi-statement
-- em transação, o que quebra VACUUM e afins; manter sempre 1 statement)
SELECT cron.schedule('refresh-vendor-metrics', '2-59/5 * * * *', 'SELECT refresh_vendor_metrics_cache()');
