-- Luyd deixa de ser "Suporte" e vira vendedor com métricas próprias.
-- A caixa da sessão suportebfg é o número dele (o support_notify_chat da loja
-- já era o número do Luyd); vira kind=vendor ligada ao vendor 10.
UPDATE inboxes SET kind='vendor', display_name='Luyd', vendor_id=10 WHERE id=6;

-- A caixa da Maiza estava ligada ao vendor do Luyd por engano, mas tem
-- histórico próprio (183 conversas, 103 análises). Cria a vendedora Maiza
-- (inativa) pra segurar esse histórico em vez de creditá-lo ao Luyd.
INSERT INTO vendors (store_id, name, label, waha_session, active, queue_order, greeting, greeting_off)
SELECT 3, 'maiza', 'maiza', 'maizabfg', false, NULL,
       'Oii, eu sou a Maiza da BF Tec Mazza!',
       'Olá! No momento estou fora do horário de atendimento.'
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE store_id=3 AND name='maiza');

UPDATE inboxes SET vendor_id=(SELECT id FROM vendors WHERE store_id=3 AND name='maiza') WHERE id=14;

SELECT i.id, i.display_name, i.kind, i.vendor_id, i.waha_session, i.active
FROM inboxes i WHERE i.store_id=3 ORDER BY i.id;
