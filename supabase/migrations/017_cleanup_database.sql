-- ============================================================
-- LIMPEZA DE EMERGÊNCIA — banco em 102% do limite free plan
-- Preserva: stores, vendors, inboxes, app_users, user_inboxes,
--           conversation_memory dos últimos 30 dias
-- Remove:   audit logs, mensagens antigas, raw JSONB, locks expirados
-- ============================================================

-- 1. Audit log (só logs operacionais, não tem valor permanente)
TRUNCATE transfer_flow_audit;

-- 2. Zera o campo `raw` JSONB de messages (maior consumidor de espaço)
--    Mantém estrutura e metadados, remove payload bruto do WAHA
UPDATE messages SET raw = NULL WHERE raw IS NOT NULL;

-- 3. Remove mensagens com mais de 30 dias
DELETE FROM messages WHERE created_at < NOW() - INTERVAL '30 days';

-- 4. Remove conversas sem atividade há mais de 30 dias
DELETE FROM conversations
WHERE last_message_at < NOW() - INTERVAL '30 days'
   OR (last_message_at IS NULL AND created_at < NOW() - INTERVAL '30 days');

-- 5. Remove memória de conversas antigas (mais de 30 dias sem atividade)
--    IA começa conversa nova normalmente com quem voltar depois disso
DELETE FROM conversation_memory WHERE updated_at < NOW() - INTERVAL '30 days';

-- 6. Locks expirados
DELETE FROM transfer_locks WHERE expires_at < NOW();

-- 7. Força desfragmentação nas tabelas principais (sem transação)
-- Executar manualmente no SQL Editor se necessário:
-- VACUUM FULL messages; VACUUM FULL conversations; VACUUM FULL conversation_memory;
