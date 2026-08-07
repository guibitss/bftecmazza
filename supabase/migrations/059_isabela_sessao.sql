-- Isabela passa a atender pela sessão isabfcm (a juliabfcm2, herdada da Julia,
-- ficou parada). Troca nos DOIS lugares: a inbox (recebe/envia no CRM) e o
-- vendor (é por ele que o transfer-flow manda a saudação de boas-vindas).
UPDATE inboxes SET waha_session = 'isabfcm' WHERE id = 9;
UPDATE vendors SET waha_session = 'isabfcm' WHERE id = 11;

SELECT 'inbox' AS onde, i.id, i.display_name AS nome, i.waha_session, i.active::text AS ativo
FROM inboxes i WHERE i.id = 9
UNION ALL
SELECT 'vendor', v.id, v.name, v.waha_session, v.active::text
FROM vendors v WHERE v.id = 11;

-- O chip novo tem número próprio (554498210926); o antigo (554497560120) era da
-- Julia. summary_chat é pra onde vai o resumo do lead transferido — e também é
-- o que marca o número como interno, pra IA não tentar atender a própria
-- vendedora. Sem isso, o resumo iria pro chip parado.
UPDATE vendors SET summary_chat = '554498210926@c.us' WHERE id = 11;
