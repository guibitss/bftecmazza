-- Alerta de desconexão de WhatsApp no sistema de alertas de métricas
ALTER TABLE metric_alerts DROP CONSTRAINT metric_alerts_metric_check;
ALTER TABLE metric_alerts ADD CONSTRAINT metric_alerts_metric_check
  CHECK (metric = ANY (ARRAY[
    'avg_response_in_hours'::text,
    'avg_response_off_hours'::text,
    'contacts'::text,
    'msgs_per_contact'::text,
    'session_down'::text
  ]));
