-- ============================================================
-- Limpeza automática do banco via pg_cron
--
-- Job 1: cleanup_daily  — todo dia às 03:00 (BRT = 06:00 UTC)
--   • Zera campo raw de mensagens novas (segurança extra)
--   • Remove mensagens, conversas e memórias com +30 dias
--   • Remove locks e audit logs antigos
--
-- Job 2: vacuum_weekly  — toda domingo às 02:00 (BRT = 05:00 UTC)
--   • VACUUM ANALYZE nas tabelas principais (não trava, libera espaço)
-- ============================================================

-- Remove jobs antigos se existirem (idempotente)
SELECT cron.unschedule('cleanup_daily')  WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup_daily'
);
SELECT cron.unschedule('vacuum_weekly')  WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'vacuum_weekly'
);

-- Job 1: limpeza diária às 06:00 UTC (03:00 BRT)
SELECT cron.schedule(
  'cleanup_daily',
  '0 6 * * *',
  $$
    -- Zera raw de mensagens que ainda tenham (segurança)
    UPDATE messages SET raw = NULL WHERE raw IS NOT NULL;

    -- Remove mensagens com mais de 30 dias
    DELETE FROM messages
    WHERE created_at < NOW() - INTERVAL '30 days';

    -- Remove conversas sem atividade há mais de 30 dias
    DELETE FROM conversations
    WHERE last_message_at < NOW() - INTERVAL '30 days'
       OR (last_message_at IS NULL AND created_at < NOW() - INTERVAL '30 days');

    -- Remove memória de conversas antigas
    DELETE FROM conversation_memory
    WHERE updated_at < NOW() - INTERVAL '30 days';

    -- Remove locks expirados
    DELETE FROM transfer_locks
    WHERE expires_at < NOW();

    -- Limpa audit log com mais de 7 dias (cresce rápido, não tem valor histórico)
    DELETE FROM transfer_flow_audit
    WHERE ts < NOW() - INTERVAL '7 days';
  $$
);

-- Job 2: VACUUM ANALYZE semanal — domingo às 05:00 UTC (02:00 BRT)
-- VACUUM ANALYZE não trava tabelas, libera espaço para reuso e atualiza estatísticas
SELECT cron.schedule(
  'vacuum_weekly',
  '0 5 * * 0',
  $$
    VACUUM ANALYZE messages;
    VACUUM ANALYZE conversations;
    VACUUM ANALYZE conversation_memory;
    VACUUM ANALYZE transfer_flow_audit;
  $$
);
