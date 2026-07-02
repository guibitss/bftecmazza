-- Habilita REPLICA IDENTITY FULL para Supabase Realtime funcionar corretamente
-- com RLS e filtros por colunas não-PK (inbox_id, conversation_id).
-- Sem isso, UPDATE events não chegam nos clientes conectados via Realtime.
ALTER TABLE conversations REPLICA IDENTITY FULL;
ALTER TABLE messages      REPLICA IDENTITY FULL;
