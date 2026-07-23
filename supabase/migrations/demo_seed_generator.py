import random, json
random.seed(42)

S = []  # SQL statements
def q(v):
    if v is None: return 'NULL'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, str) and v.startswith('now()'): return v
    if isinstance(v, (dict, list)): return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"

# ---- LOJA ----
S.append("INSERT INTO demo.stores (id, slug, inbox_id, waha_url, bot_session, support_session, support_notify_chat, support_label, system_prompt, active, ticket_medio) VALUES "
         "(1,'bftecmazza',900,'http://demo.local','botdemo','supdemo','5544900000000@c.us','suporte','Você é a IA da loja (demo).',true,8000);")

# ---- VENDEDORAS (fictícias) ----
# perfil: (nome, nota_base, taxa_venda, followup_bom)
vendors = [
    (1,'larissa', 7.6, 0.22, True),
    (2,'rafael',  6.4, 0.14, True),
    (3,'camila',  5.3, 0.08, False),
]
for vid,nome,_,_,_ in vendors:
    S.append(f"INSERT INTO demo.vendors (id,store_id,name,label,waha_session,summary_chat,greeting,greeting_off,queue_order,active,lunch_start,lunch_end) VALUES "
             f"({vid},1,{q(nome)},{q(nome)},{q(nome+'demo')},{q(f'554490000000{vid}@c.us')},'Oi! Aqui é a {nome.title()}, vou te atender 😊','Oi! Retorno assim que abrir a loja.',{vid},true,'12:00','13:00');")

# ---- INBOXES ----
S.append("INSERT INTO demo.inboxes (id,store_id,waha_session,kind,vendor_id,display_name,active,created_at) VALUES "
         "(900,1,'botdemo','ai',NULL,'IA',true,now()),"
         "(901,1,'supdemo','support',NULL,'Suporte',true,now()),"
         "(1,1,'larissademo','vendor',1,'Larissa',true,now()),"
         "(2,1,'rafaeldemo','vendor',2,'Rafael',true,now()),"
         "(3,1,'camilademo','vendor',3,'Camila',true,now());")

# ---- USUÁRIO DEMO (login) + acesso ----
DEMO_UID = '00000000-0000-0000-0000-0000000000de'
S.append(f"INSERT INTO demo.app_users (id,email,name,is_admin,manager_of_store_id,active,status) VALUES "
         f"('{DEMO_UID}','demo@chateaulabs.shop','Demonstração',true,NULL,true,'approved');")

# ---- FILA ----
S.append("INSERT INTO demo.vendor_queue (store_id,current_vendor) VALUES (1,'larissa');")

# ---- ETIQUETAS ----
S.append("INSERT INTO demo.labels (id,store_id,name,color,owner_user_id) VALUES "
         "(gen_random_uuid(),1,'vendido','#22c55e',NULL),"
         "(gen_random_uuid(),1,'quente','#f97316',NULL),"
         "(gen_random_uuid(),1,'aguardando','#3b82f6',NULL);")

# ---- CAMPANHAS (gasto) ----
camps = [
    ('120880000000000001','iPhone 15 — Volta às Aulas', 3200.00),
    ('120880000000000002','Troca Premiada iPhone 13/14', 2450.00),
    ('120880000000000003','Black Week Apple', 1800.00),
]
for cid,cname,spend in camps:
    for d in range(28):
        S.append(f"INSERT INTO demo.ad_campaign_spend (campaign_id,date,campaign_name,account_id,spend,synced_at) VALUES "
                 f"({q(cid)},(now() - interval '{d} days')::date,{q(cname)},'act_demo',{round(spend/28,2)},now());")

# nomes fictícios de clientes
FIRST = ['Ana','Bruno','Carla','Diego','Eduarda','Felipe','Gabriela','Henrique','Isabela','João',
         'Karina','Lucas','Marina','Nicolas','Olívia','Paulo','Renata','Sérgio','Tainá','Vitor',
         'Wesley','Yara','Bianca','Caio','Débora','Elias','Fernanda','Gustavo','Helena','Igor']
LAST = ['Silva','Souza','Oliveira','Costa','Pereira','Almeida','Ferreira','Rodrigues','Gomes','Martins']
PRODUCTS = ['iPhone 15 Pro Max 256gb','iPhone 15 128gb','iPhone 14 Pro 128gb','iPhone 13 128gb','iPhone 15 Plus 256gb','iPhone 14 128gb']

msg_id = 1
conv_id = 1
convs, msgs, analyses, mems, audits, conv_labels = [], [], [], [], [], []

# diálogo showcase (melhor atendimento — Larissa, venda)
SHOWCASE = [
    ('in','Oi boa tarde! Vi o anúncio do iPhone 15 Pro Max, ainda tem?'),
    ('out','Oiee boa tarde! Tenho sim 😍 Você prefere de qual cor? Tenho Titânio Natural e Azul'),
    ('in','O natural. Quanto fica?'),
    ('out','O 256gb Titânio Natural sai R$ 7.499 à vista'),
    ('out','No cartão consigo 12x de R$ 699 sem juros 💳'),
    ('in','E vocês pegam meu 13 na troca?'),
    ('out','Pegamos sim! Seu 13 é de quantos gb e como está a bateria?'),
    ('in','128gb, bateria 89%, sem detalhe nenhum'),
    ('out','Perfeito! Nesse estado avalio seu 13 em R$ 2.900'),
    ('out','Aí sua diferença fica só R$ 4.599 — posso parcelar em 10x de R$ 459 😉'),
    ('in','Gostei! Consigo passar aí amanhã?'),
    ('out','Claro! Te espero. Quer que eu já deixe o aparelho separado no seu nome?'),
    ('in','Pode separar sim, obrigada!'),
    ('out','Separado 🙌 Te mando o endereço e meu horário. Até amanhã!'),
]

def add_conv(inbox_id, vendor_id, cust_name, phone, days_ago, dialogue, kind_last='text',
             ad=None, analysis=None, labels=None, memory=False):
    global conv_id, msg_id
    cid = conv_id; conv_id += 1
    first_at = f"now() - interval '{days_ago} days'"
    last_at  = f"now() - interval '{days_ago} days' + interval '{len(dialogue)*4} minutes'"
    preview = dialogue[-1][1][:60]
    convs.append((cid, inbox_id, vendor_id, cust_name, phone, first_at, last_at, preview, ad))
    for i,(direction, text) in enumerate(dialogue):
        at = f"now() - interval '{days_ago} days' + interval '{i*4} minutes'"
        atype = 'customer' if direction=='in' else ('vendor' if vendor_id else 'ai')
        msgs.append((msg_id, cid, inbox_id, vendor_id, direction, atype, text, at))
        msg_id += 1
    if analysis is not None:
        analyses.append((cid, vendor_id, len(dialogue), last_at, analysis))
    if labels:
        for lb in labels: conv_labels.append((cid, lb))
    if memory:
        mems.append((phone, last_at))
    return cid

# showcase
add_conv(1, 1, 'Ana Beatriz Correia', '+554498100001', 2, SHOWCASE, ad=camps[0][0],
    analysis=dict(nota=9, desfecho='vendido', fech=2, fu_op=False, fu_feito=False,
        estoque='nao_ocorreu', parc=True, qual=True,
        objecoes=[{'tipo':'preco','quebrada':True,'trecho':'E vocês pegam meu 13 na troca?'}],
        erros=[], fortes=['Qualificou o aparelho de troca antes do preço','Fechamento claro com separação do produto'],
        sugestoes=['Registrar o retorno agendado no sistema'],
        evid={'fechamento':'Quer que eu já deixe o aparelho separado no seu nome?','followup':'','estoque':''}),
    labels=['vendido'], memory=True)

# gerador de conversas variadas
def gen_dialogue(prod, outcome):
    d = [('in', f'Oi, bom dia! Queria saber o valor do {prod}')]
    price = random.choice(['R$ 4.699','R$ 5.899','R$ 7.199','R$ 3.999','R$ 6.499'])
    if outcome in ('vendido','agendou','negociando'):
        d += [('out', f'Bom dia! O {prod} sai por {price} à vista 😊'),
              ('out', f'No cartão faço em até 12x'),
              ('in','Tem desconto no pix?'),
              ('out','No pix consigo 5% de desconto!'),
              ('in','E troca no meu aparelho atual?')]
        if random.random()<0.6:
            d += [('out','Pegamos sim, me manda modelo e estado que já avalio'),
                  ('in','iPhone 12 64gb, bateria 84%'),
                  ('out','Avalio em R$ 1.900, aí sua diferença cai bastante 😉')]
        if outcome=='vendido':
            d += [('in','Fechado, vou querer!'),('out','Aeee 🎉 já vou separar pra você!')]
        elif outcome=='agendou':
            d += [('in','Passo aí sábado pra fechar'),('out','Combinado! Te espero 🙌')]
        else:
            d += [('in','Vou pensar e te falo'),('out','Tranquilo! Fico à disposição 😊')]
    elif outcome=='esfriou':
        d += [('out', f'Oi! O {prod} está {price}'),
              ('in','Ah tá'),('out','Quer que eu veja condição de parcelamento?')]
    else:  # perdido
        d += [('out', f'Oi! Fica {price}'),
              ('in','Achei mais barato em outra loja, obrigada')]
    return d

# distribuição por vendedora (nota, quantidade, mix de desfechos)
plan = {
  1: dict(n=11, notas=(7,9), mix=['vendido','vendido','agendou','negociando','esfriou','negociando','vendido','agendou','negociando','esfriou','perdido']),
  2: dict(n=10, notas=(5,8), mix=['vendido','negociando','esfriou','esfriou','agendou','negociando','esfriou','vendido','perdido','negociando']),
  3: dict(n=10, notas=(4,7), mix=['esfriou','esfriou','perdido','negociando','esfriou','vendido','esfriou','perdido','negociando','esfriou']),
}
OBJ_TYPES = ['preco','preco','preco','concorrencia','estoque','prazo','confianca']
for vid,nome,nbase,tvenda,fubom in vendors:
    p = plan[vid]
    for k in range(p['n']):
        outcome = p['mix'][k % len(p['mix'])]
        prod = random.choice(PRODUCTS)
        dia = random.randint(1, 29)
        dlg = gen_dialogue(prod, outcome)
        cust = f"{random.choice(FIRST)} {random.choice(LAST)}"
        phone = f"+55449{random.randint(1000000,9999999)}"
        nota = random.randint(*p['notas'])
        if outcome in ('perdido','esfriou'): nota = min(nota, 4 if outcome=='perdido' else 6)
        fu_op = outcome in ('esfriou','negociando') and random.random()<0.8
        fu_feito = fu_op and fubom and random.random()<0.6
        has_obj = random.random()<0.6
        obj=[]
        if has_obj:
            t=random.choice(OBJ_TYPES)
            que = True if (outcome=='vendido' and random.random()<0.5) else (None if random.random()<0.2 else False)
            obj=[{'tipo':t,'quebrada':que,'trecho':'Tem desconto no pix?' if t=='preco' else 'Achei em outra loja'}]
        ad = camps[k%3][0] if random.random()<0.4 else None
        analysis=dict(nota=nota, desfecho=outcome, fech=random.randint(0,2), fu_op=fu_op, fu_feito=fu_feito,
            estoque=random.choice(['nao_ocorreu','nao_ocorreu','ponte','negativa_seca']),
            parc=random.random()<0.6, qual=random.random()<0.5, objecoes=obj, erros=[],
            fortes=['Resposta rápida'] if nota>=7 else [],
            sugestoes=['Fazer pergunta de fechamento'] if outcome!='vendido' else ['Registrar a venda no sistema'],
            evid={'fechamento':'','followup':'','estoque':''})
        labels = ['vendido'] if outcome=='vendido' else (['quente'] if outcome in ('negociando','agendou') else None)
        add_conv(vid, vid, cust, phone, dia, dlg, ad=ad, analysis=analysis, labels=labels,
                 memory=True)

# algumas conversas na IA (triagem) — sem análise de vendedor
for k in range(8):
    prod = random.choice(PRODUCTS)
    dlg = [('in',f'Oi, tem {prod}?'),('out','Oi! Vou te encaminhar pra uma vendedora que te passa tudo certinho 😊')]
    add_conv(900, None, f"{random.choice(FIRST)} {random.choice(LAST)}", f"+55449{random.randint(1000000,9999999)}",
             random.randint(1,20), dlg, memory=True)

# ------- emite SQL -------
LABEL_MAP = "(SELECT id FROM demo.labels WHERE name=%s LIMIT 1)"
for cid, inbox, vid, name, phone, fat, lat, prev, ad in convs:
    adcols = ''
    advals = ''
    if ad:
        cname = next(c[1] for c in camps if c[0]==ad)
        adcols = ", ad_source_id, ad_campaign_id, ad_campaign_name, ad_resolved_at"
        advals = f", {q(ad)}, {q(ad)}, {q(cname)}, now()"
    assigned = vid if vid else 'NULL'
    S.append(f"INSERT INTO demo.conversations (id,inbox_id,store_id,waha_id,customer_phone,customer_name,status,assigned_vendor_id,unread_count,first_message_at,last_message_at,last_message_preview{adcols}) "
             f"VALUES ({cid},{inbox},1,{q(phone.replace('+','')+'@c.us')},{q(phone)},{q(name)},'open',{assigned},0,{fat},{lat},{q(prev)}{advals});")

for mid, cid, inbox, vid, direction, atype, text, at in msgs:
    S.append(f"INSERT INTO demo.messages (id,conversation_id,inbox_id,store_id,direction,author_type,author_id,kind,body,ack,sent_via,created_at) "
             f"VALUES ({mid},{cid},{inbox},1,{q(direction)},{q(atype)}::message_author,{vid if vid else 'NULL'},'text',{q(text)},1,'demo',{at});")

for cid, vid, mc, lat, a in analyses:
    S.append("INSERT INTO demo.conversation_analysis (conversation_id,store_id,vendor_id,analyzed_at,last_message_at,model,msg_count,audio_count,"
             "fechamento_count,followup_oportunidade,followup_feito,estoque_situacao,parcelamento_proativo,qualificou_antes_preco,desfecho,"
             "erros,pontos_fortes,sugestoes,evidencias,nota_geral,objecoes,prompt_version,analisavel,eh_atendimento) VALUES "
             f"({cid},1,{vid},now(),{lat},'demo',{mc},0,{a['fech']},{q(a['fu_op'])},{q(a['fu_feito'])},{q(a['estoque'])},"
             f"{q(a['parc'])},{q(a['qual'])},{q(a['desfecho'])},{q(a['erros'])},{q(a['fortes'])},{q(a['sugestoes'])},{q(a['evid'])},"
             f"{a['nota']},{q(a['objecoes'])},3,true,true);")

for cid, lb in conv_labels:
    S.append(f"INSERT INTO demo.conversation_labels (conversation_id,label_id,assigned_at) SELECT {cid}, id, now() FROM demo.labels WHERE name={q(lb)} LIMIT 1;")

# memória (dashboard) + audit de transferências
for phone, lat in mems:
    S.append(f"INSERT INTO demo.conversation_memory (phone,store_id,messages,updated_at) VALUES ({q(phone)},1,'[]'::jsonb,{lat}) ON CONFLICT DO NOTHING;")
# transfer audit: invoked/done pra taxa de transferência
for i in range(35):
    d = random.randint(1,7)
    src = f"'demo-{i}'"
    S.append(f"INSERT INTO demo.transfer_flow_audit (source_id,store_id,step,ts) VALUES ({src},1,'invoked',now() - interval '{d} days');")
    if random.random()<0.85:
        S.append(f"INSERT INTO demo.transfer_flow_audit (source_id,store_id,step,ts) VALUES ({src},1,'done',now() - interval '{d} days');")

sql = "\n".join(S)
open('demo_seed.sql','w').write(sql)
print(f"gerado: {len(S)} statements, {len(convs)} conversas, {len(msgs)} mensagens, {len(analyses)} análises")
