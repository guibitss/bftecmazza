-- Índice parcial para as funções de métricas de vendedores
-- (vendor_response_metrics / vendor_volume_metrics filtram por
-- author_type + author_id + created_at; sem índice era seq scan de ~13s).
-- Já aplicado em produção via CREATE INDEX CONCURRENTLY em 2026-07-05.
CREATE INDEX IF NOT EXISTS msg_vendor_activity_idx
  ON messages (author_id, created_at DESC)
  INCLUDE (conversation_id, direction)
  WHERE author_type = 'vendor';
