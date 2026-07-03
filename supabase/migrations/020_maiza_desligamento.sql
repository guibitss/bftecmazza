-- ============================================================
-- Maiza desligada — leads permanentemente encaminhados ao Luyd (suportebfg)
-- Data: 2026-07-01
-- ============================================================

-- Desativa conta de acesso
UPDATE app_users SET active = false WHERE email = 'maizabftecmazza@gmail.com';

-- Redireciona vendor para o suporte do Luyd
UPDATE vendors SET
  waha_session = 'suportebfg',
  summary_chat = '554291148638@c.us',
  greeting     = 'Olá! Aqui é o Luyd do Grupo BF Tec Mazza. Como posso te ajudar? 😊',
  greeting_off = 'Olá! 👋 No momento estamos fora do horário de atendimento, mas assim que possível entraremos em contato. Obrigado pela compreensão! 😊'
WHERE store_id = 3 AND name = 'maiza';

-- Desativa inbox (não aparece mais no CRM/Conexões)
UPDATE inboxes SET active = false WHERE waha_session = 'maizabfg';
