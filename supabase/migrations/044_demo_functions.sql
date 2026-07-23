CREATE OR REPLACE FUNCTION demo.analysis_objecoes(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(tipo text, total bigint, avaliaveis bigint, quebradas bigint, indeterminadas bigint)
 LANGUAGE sql
 SET search_path = demo, public
 STABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION demo.analysis_perdas(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(esfriados bigint, followup_perdidos bigint, negativas_secas bigint)
 LANGUAGE sql
 SET search_path = demo, public
 STABLE
AS $function$
  SELECT
    count(*) FILTER (WHERE desfecho IN ('esfriou', 'perdido')),
    count(*) FILTER (WHERE followup_oportunidade AND NOT followup_feito),
    count(*) FILTER (WHERE estoque_situacao = 'negativa_seca')
  FROM conversation_analysis
  WHERE last_message_at >= p_from AND last_message_at < p_to
    AND analisavel AND eh_atendimento;
$function$;

CREATE OR REPLACE FUNCTION demo.analysis_valor_risco(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(store_id integer, slug text, ticket_medio numeric, followup_perdidos bigint, esfriados bigint, conversao_pct numeric, valor_risco numeric)
 LANGUAGE sql
 SET search_path = demo, public
 STABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION demo.campaign_metrics_range(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(campaign_id text, campaign_name text, leads bigint, vendas bigint, conversao numeric, gasto numeric, custo_lead numeric, custo_venda numeric)
 LANGUAGE sql
 SET search_path = demo, public
 STABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION demo.is_business_hour(ts timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path = demo, public
 IMMUTABLE
AS $function$
DECLARE
  d INT;   -- 0=Dom, 6=Sab
  h INT;
BEGIN
  d := EXTRACT(DOW FROM (ts AT TIME ZONE 'America/Sao_Paulo'));
  h := EXTRACT(HOUR FROM (ts AT TIME ZONE 'America/Sao_Paulo'));
  IF d = 0 THEN RETURN FALSE; END IF;             -- domingo
  IF d = 6 THEN RETURN h >= 8 AND h < 13; END IF; -- sábado
  RETURN h >= 8 AND h < 18;                       -- seg-sex
END;
$function$;

CREATE OR REPLACE FUNCTION demo.phone_norm(p text)
 RETURNS text
 LANGUAGE sql
 SET search_path = demo, public
 IMMUTABLE
AS $function$
  SELECT regexp_replace(
           regexp_replace(COALESCE(p, ''), '\D', '', 'g'),
           '^(55)(\d{2})9(\d{8})$', '\1\2\3');
$function$;

CREATE OR REPLACE FUNCTION demo.resolve_session(p_session text)
 RETURNS TABLE(inbox_id bigint, store_id integer, vendor_id integer, session_role text)
 LANGUAGE sql
 SET search_path = demo, public
 STABLE
AS $function$
  SELECT i.id, i.store_id, i.vendor_id, i.kind::text
  FROM inboxes i
  WHERE i.waha_session = p_session AND i.active
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION demo.store_vendor_metrics(p_store_id integer, p_days integer DEFAULT 30)
 RETURNS TABLE(vendor_id integer, vendor_name text, in_hours_avg_secs numeric, in_hours_count bigint, off_hours_avg_secs numeric, off_hours_count bigint, contacts bigint, msgs_per_contact numeric)
 LANGUAGE plpgsql
 SET search_path = demo, public
 STABLE
AS $function$
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

CREATE OR REPLACE FUNCTION demo.store_vendor_metrics_v2(p_store_id integer, p_days integer DEFAULT 30)
 RETURNS TABLE(vendor_id integer, vendor_name text, in_hours_avg_secs numeric, in_hours_count bigint, off_hours_avg_secs numeric, off_hours_count bigint, contacts bigint, msgs_per_contact numeric)
 LANGUAGE sql
 SET search_path = demo, public
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

CREATE OR REPLACE FUNCTION demo.vendor_objecoes(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(vendor_id integer, avaliaveis bigint, quebradas bigint, indeterminadas bigint)
 LANGUAGE sql
 SET search_path = demo, public
 STABLE
AS $function$
  SELECT ca.vendor_id,
    count(*) FILTER (WHERE o->>'quebrada' IS NOT NULL AND o->>'quebrada' <> 'null'),
    count(*) FILTER (WHERE (o->>'quebrada') = 'true'),
    count(*) FILTER (WHERE o->>'quebrada' IS NULL OR o->>'quebrada' = 'null')
  FROM conversation_analysis ca,
       jsonb_array_elements(COALESCE(ca.objecoes, '[]'::jsonb)) o
  WHERE ca.last_message_at >= p_from AND ca.last_message_at < p_to
    AND ca.analisavel AND ca.vendor_id IS NOT NULL
  GROUP BY ca.vendor_id;
$function$;

CREATE OR REPLACE FUNCTION demo.vendor_quality_metrics(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(vendor_id integer, vendor_name text, store_id integer, convs_analisadas bigint, fechamento_por_conv numeric, convs_sem_fechamento bigint, followup_oportunidades bigint, followup_feitos bigint, estoque_pontes bigint, estoque_negativas_secas bigint, parcelamento_proativo_pct numeric, qualificacao_pct numeric, vendidos bigint, esfriados bigint, prospeccao_ativa bigint, audio_pct numeric, nota_media numeric, objecoes_total bigint, objecoes_quebradas bigint, erros_total bigint)
 LANGUAGE sql
 SET search_path = demo, public
 STABLE
AS $function$
  WITH a AS (
    SELECT * FROM conversation_analysis
    WHERE last_message_at >= p_from AND last_message_at < p_to AND vendor_id IS NOT NULL
      AND analisavel AND eh_atendimento
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
$function$;

CREATE OR REPLACE FUNCTION demo.vendor_response_metrics(p_vendor_id integer, p_days integer DEFAULT 30, p_in_hours boolean DEFAULT NULL::boolean)
 RETURNS TABLE(avg_seconds numeric, responses_count bigint, median_seconds numeric)
 LANGUAGE sql
 SET search_path = demo, public
 STABLE
AS $function$
  WITH out_msgs AS (
    SELECT m.id, m.conversation_id, m.created_at AS out_at
    FROM messages m
    WHERE m.author_type = 'vendor'
      AND m.author_id   = p_vendor_id
      AND m.direction   = 'out'
      AND m.created_at >= NOW() - (p_days || ' days')::INTERVAL
  ),
  -- pra cada msg out, pega a msg in mais recente ANTERIOR na mesma conversa
  pairs AS (
    SELECT
      o.out_at,
      (SELECT MAX(m_in.created_at)
       FROM messages m_in
       WHERE m_in.conversation_id = o.conversation_id
         AND m_in.direction = 'in'
         AND m_in.created_at < o.out_at) AS in_at
    FROM out_msgs o
  ),
  -- só conta o PRIMEIRO out depois de cada in (não conta msgs subsequentes do vendedor no mesmo bloco)
  firsts AS (
    SELECT DISTINCT ON (in_at) in_at, out_at
    FROM pairs
    WHERE in_at IS NOT NULL
      AND out_at - in_at <= INTERVAL '24 hours'  -- ignora gap > 24h
      AND (p_in_hours IS NULL OR is_business_hour(in_at) = p_in_hours)
    ORDER BY in_at, out_at
  )
  SELECT
    ROUND(AVG(EXTRACT(EPOCH FROM (out_at - in_at)))::NUMERIC, 1) AS avg_seconds,
    COUNT(*)::BIGINT AS responses_count,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (out_at - in_at))
    )::NUMERIC, 1) AS median_seconds
  FROM firsts;
$function$;

CREATE OR REPLACE FUNCTION demo.vendor_volume_metrics(p_vendor_id integer, p_days integer DEFAULT 30)
 RETURNS TABLE(contacts bigint, out_msgs bigint, in_msgs bigint, msgs_per_contact numeric)
 LANGUAGE sql
 SET search_path = demo, public
 STABLE
AS $function$
  WITH active_convs AS (
    SELECT DISTINCT conversation_id
    FROM messages
    WHERE author_type = 'vendor'
      AND author_id   = p_vendor_id
      AND created_at >= NOW() - (p_days || ' days')::INTERVAL
  )
  SELECT
    (SELECT COUNT(*) FROM active_convs)::BIGINT AS contacts,
    COUNT(*) FILTER (WHERE m.direction = 'out')::BIGINT AS out_msgs,
    COUNT(*) FILTER (WHERE m.direction = 'in')::BIGINT  AS in_msgs,
    ROUND(COUNT(*)::NUMERIC / NULLIF((SELECT COUNT(*) FROM active_convs), 0), 1) AS msgs_per_contact
  FROM messages m
  WHERE m.conversation_id IN (SELECT conversation_id FROM active_convs)
    AND m.created_at >= NOW() - (p_days || ' days')::INTERVAL;
$function$;
