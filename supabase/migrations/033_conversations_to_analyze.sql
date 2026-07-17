-- Seleção de conversas pendentes de análise (novas ou com mensagens novas
-- desde a última análise)
CREATE OR REPLACE FUNCTION conversations_to_analyze(p_since timestamptz, p_limit int DEFAULT 60)
RETURNS TABLE(id int, store_id int, vendor_id int, last_message_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.store_id, i.vendor_id, c.last_message_at
  FROM conversations c
  JOIN inboxes i ON i.id = c.inbox_id AND i.kind = 'vendor' AND i.vendor_id IS NOT NULL
  LEFT JOIN conversation_analysis ca ON ca.conversation_id = c.id
  WHERE c.last_message_at >= p_since
    AND (ca.conversation_id IS NULL OR ca.analyzed_at < c.last_message_at)
  ORDER BY c.last_message_at DESC
  LIMIT p_limit;
$$;
