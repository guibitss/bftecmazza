-- Roda VACUUM FULL imediatamente via pg_cron (job único, se auto-remove)
-- Agenda para o próximo minuto e roda uma vez só
SELECT cron.unschedule('vacuum_full_once') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'vacuum_full_once'
);

SELECT cron.schedule(
  'vacuum_full_once',
  '* * * * *',   -- todo minuto (vai rodar na próxima oportunidade)
  $$
    VACUUM FULL messages;
    VACUUM FULL conversations;
    VACUUM FULL conversation_memory;
    VACUUM FULL transfer_flow_audit;
    -- Remove este job após executar
    SELECT cron.unschedule('vacuum_full_once');
  $$
);
