-- ============================================================
-- TEMPORÁRIO: Maiza doente — leads redirecionados ao suporte (GP)
-- O suporte recebe os leads dela via waha_session = suportebfg
-- e summary_chat aponta pro número de notificação do suporte.
-- Isso NÃO altera o fluxo de suporte normal (handleSupport).
--
-- Para reverter quando ela voltar:
--   UPDATE vendors SET
--     waha_session = 'maizabfg',
--     summary_chat = NULL,
--     greeting     = 'Olá. Esperamos que você esteja bem! Sou a Maiza e faço parte do Grupo BF TEC MAZZA.',
--     greeting_off = 'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você.Obrigado pela compreensão! 😊'
--   WHERE store_id = 3 AND name = 'maiza';
-- ============================================================

UPDATE vendors SET
  waha_session = 'suportebfg',
  summary_chat = '554291642868@c.us',
  greeting     = 'Olá. Esperamos que você esteja bem! Já vou te atender por aqui 😊',
  greeting_off = 'Olá! 👋 No momento estamos fora do horário de atendimento, mas assim que possível entraremos em contato. Obrigado pela compreensão! 😊'
WHERE store_id = 3 AND name = 'maiza';
