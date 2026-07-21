-- Telemetria técnica pro cockpit da Chateau Labs (só agregados, sem PII).
-- atendimentos       = clientes distintos atendidos no mês corrente (BRT)
-- resolved_pct       = % desses que ficaram só na IA (nunca foram pra caixa
--                      de vendedor/suporte) — "resolvido sem humano"
-- last_msg_age_secs  = idade da última mensagem ingerida (saúde da ingestão)
--
-- Baseado só em `conversations` (retenção de 30d consistente); NÃO usa
-- transfer_flow_audit, que é podada a cada 7 dias e distorceria o mês.
CREATE OR REPLACE FUNCTION chateau_telemetry()
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
    WHERE c.last_message_at >= ms.start
  ),
  tot AS (SELECT count(DISTINCT cust) AS n FROM conv),
  hum AS (SELECT count(DISTINCT cust) AS n FROM conv WHERE kind IN ('vendor', 'support')),
  age AS (
    SELECT EXTRACT(EPOCH FROM (now() - max(created_at)))::int AS secs
    FROM messages WHERE sent_via = 'waha'
  )
  SELECT
    tot.n,
    CASE WHEN tot.n > 0
      THEN GREATEST(0, LEAST(100, round(100.0 * (tot.n - hum.n) / tot.n)::int))
      ELSE 0 END,
    age.secs
  FROM tot, hum, age;
$$;
