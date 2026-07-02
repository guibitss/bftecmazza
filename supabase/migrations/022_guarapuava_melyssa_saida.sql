-- Guarapuava: remove Melyssa, reordena fila (Gabi=0, Duda=1, Luyd=2)
-- Renomeia registro da maiza para luyd (sessão já era suportebfg desde 020)
UPDATE vendors SET active = false WHERE store_id = 3 AND name = 'melyssa';

UPDATE vendors SET name = 'luyd', label = 'luyd', queue_order = 2
  WHERE store_id = 3 AND name = 'maiza';

UPDATE vendors SET queue_order = 0 WHERE store_id = 3 AND name = 'gabriele';
UPDATE vendors SET queue_order = 1 WHERE store_id = 3 AND name = 'mariaeduarda';
