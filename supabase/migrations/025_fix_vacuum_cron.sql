-- Conserta os jobs de VACUUM do pg_cron
-- (já aplicado em produção via Management API em 2026-07-07)
--
-- CAUSA: pg_cron envolve comandos multi-statement em transação, e VACUUM
-- não roda dentro de transação. Resultado: vacuum_weekly NUNCA executou e
-- vacuum_full_once falhava A CADA MINUTO desde a criação (o self-unschedule
-- também nunca rodava). Com cleanup diário deletando mensagens e zero
-- vacuum, messages chegou a 174 MB para ~85k linhas vivas.
--
-- REGRA: job de pg_cron com VACUUM precisa ser statement ÚNICO.

DO $$
BEGIN
  PERFORM cron.unschedule('vacuum_full_once');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('vacuum_weekly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('vacuum-messages',      '17 5 * * 0', 'VACUUM ANALYZE messages');
SELECT cron.schedule('vacuum-conversations', '21 5 * * 0', 'VACUUM ANALYZE conversations');
SELECT cron.schedule('vacuum-memory',        '24 5 * * 0', 'VACUUM ANALYZE conversation_memory');
SELECT cron.schedule('vacuum-audit',         '27 5 * * 0', 'VACUUM ANALYZE transfer_flow_audit');

-- O VACUUM FULL único (desinchar os 174 MB acumulados) é manual, rodado
-- no SQL Editor fora de horário de pico — trava a tabela durante a compactação:
--   VACUUM FULL messages;
--   VACUUM FULL conversations;
--   VACUUM FULL conversation_memory;
--   VACUUM FULL transfer_flow_audit;
