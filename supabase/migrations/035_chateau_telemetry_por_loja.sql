-- Telemetria separada por serviço (cada loja + o CRM têm token próprio no
-- cockpit). Substitui a versão agregada da migração 034.
DROP FUNCTION IF EXISTS chateau_telemetry();

-- Por LOJA (IA de atendimento): atendimentos do mês + % resolvido sem humano
CREATE OR REPLACE FUNCTION chateau_telemetry(p_store_id int)
RETURNS TABLE(atendimentos bigint, resolved_pct int, last_msg_age_secs int)
LANGUAGE sql STABLE AS $$
  WITH ms AS (
    SELECT (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'))
             AT TIME ZONE 'America/Sao_Paulo' AS start
  ),
  conv AS (
    SELECT DISTINCT COALESCE(c.customer_phone, c.waha_id) AS cust, i.kind
    FROM conversations c
    JOIN inboxes i ON i.id = c.inbox_id
    CROSS JOIN ms
    WHERE c.store_id = p_store_id AND c.last_message_at >= ms.start
  ),
  tot AS (SELECT count(DISTINCT cust) AS n FROM conv),
  hum AS (SELECT count(DISTINCT cust) AS n FROM conv WHERE kind IN ('vendor', 'support')),
  age AS (
    SELECT EXTRACT(EPOCH FROM (now() - max(created_at)))::int AS secs
    FROM messages WHERE sent_via = 'waha' AND store_id = p_store_id
  )
  SELECT
    tot.n,
    CASE WHEN tot.n > 0
      THEN GREATEST(0, LEAST(100, round(100.0 * (tot.n - hum.n) / tot.n)::int))
      ELSE 0 END,
    age.secs
  FROM tot, hum, age;
$$;

-- Do CRM (app web): volume de mensagens enviadas por humanos pelo CRM no mês
-- e taxa de entrega (ack) — saúde de uso do app, sem PII.
CREATE OR REPLACE FUNCTION chateau_crm_telemetry()
RETURNS TABLE(msgs bigint, delivered_pct int)
LANGUAGE sql STABLE AS $$
  WITH ms AS (
    SELECT (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'))
             AT TIME ZONE 'America/Sao_Paulo' AS start
  ),
  m AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE ack >= 1) AS delivered
    FROM messages CROSS JOIN ms
    WHERE sent_via = 'manual' AND created_at >= ms.start
  )
  SELECT total,
    CASE WHEN total > 0 THEN round(100.0 * delivered / total)::int ELSE 100 END
  FROM m;
$$;
