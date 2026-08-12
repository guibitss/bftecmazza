/**
 * Converte áudio WebM/Opus em Ogg/Opus, no navegador.
 *
 * Por que existe: o WhatsApp só entrega nota de voz em Ogg/Opus. O MediaRecorder
 * do Chrome (e derivados) grava apenas WebM. Os áudios gravados no CRM saíam em
 * WebM e ficavam presos em ack=1 — aceitos pelo servidor, nunca entregues ao
 * cliente.
 *
 * WebM e Ogg são só recipientes: o áudio dentro já é Opus nos dois casos. Então
 * aqui não há recodificação — extraímos os quadros Opus do WebM e os
 * reempacotamos em páginas Ogg. É rápido (milissegundos) e sem perda.
 */

// ── Leitura do WebM (EBML) ───────────────────────────────────────────────────

/** Lê um id/tamanho EBML a partir de `pos`. */
function readVint(b: Uint8Array, pos: number, manterMarcador: boolean): { valor: number; bytes: number } {
  const primeiro = b[pos];
  if (primeiro === undefined) return { valor: 0, bytes: 0 };
  let comprimento = 1;
  for (let m = 0x80; m > 0 && !(primeiro & m); m >>= 1) comprimento++;
  if (comprimento > 8) return { valor: 0, bytes: 0 };

  let valor = manterMarcador ? primeiro : primeiro & (0xff >> comprimento);
  for (let i = 1; i < comprimento; i++) valor = valor * 256 + b[pos + i];
  return { valor, bytes: comprimento };
}

/** Quadros Opus de um WebM, na ordem. */
function extrairQuadrosOpus(dados: Uint8Array): Uint8Array[] {
  const quadros: Uint8Array[] = [];
  // Containers que devemos percorrer por dentro em vez de pular
  const CONTAINERS = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xe1, 0x1a45dfa3]);

  function percorrer(inicio: number, fim: number) {
    let pos = inicio;
    while (pos < fim) {
      const id = readVint(dados, pos, true);
      if (!id.bytes) return;
      pos += id.bytes;
      const tam = readVint(dados, pos, false);
      if (!tam.bytes) return;
      pos += tam.bytes;

      // Tamanho desconhecido (live): segue lendo até o fim
      const conteudoFim = tam.valor === 0x00ffffffffffff ? fim : Math.min(pos + tam.valor, fim);

      if (CONTAINERS.has(id.valor)) {
        percorrer(pos, conteudoFim);
      } else if (id.valor === 0xa3) {
        // SimpleBlock: [track vint][timecode int16][flags int8][payload...]
        const track = readVint(dados, pos, false);
        const dadosInicio = pos + track.bytes + 3;
        if (dadosInicio < conteudoFim) quadros.push(dados.slice(dadosInicio, conteudoFim));
      } else if (id.valor === 0xa0) {
        // BlockGroup → o Block dentro tem o mesmo layout
        let p = pos;
        while (p < conteudoFim) {
          const bid = readVint(dados, p, true);
          if (!bid.bytes) break;
          p += bid.bytes;
          const btam = readVint(dados, p, false);
          if (!btam.bytes) break;
          p += btam.bytes;
          const bfim = Math.min(p + btam.valor, conteudoFim);
          if (bid.valor === 0xa1) {
            const track = readVint(dados, p, false);
            const dadosInicio = p + track.bytes + 3;
            if (dadosInicio < bfim) quadros.push(dados.slice(dadosInicio, bfim));
          }
          p = bfim;
        }
      }
      pos = conteudoFim;
    }
  }

  percorrer(0, dados.length);
  return quadros;
}

// ── Escrita do Ogg ───────────────────────────────────────────────────────────

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    t[i] = r >>> 0;
  }
  return t;
})();

function crc32Ogg(b: Uint8Array): number {
  let r = 0;
  for (let i = 0; i < b.length; i++) r = ((r << 8) ^ TABELA_CRC[((r >>> 24) & 0xff) ^ b[i]]) >>> 0;
  return r >>> 0;
}

/** Monta uma página Ogg. */
function paginaOgg(
  segmentos: Uint8Array[],
  numeroPagina: number,
  granulos: number,
  inicio: boolean,
  fim: boolean,
): Uint8Array {
  const tabela: number[] = [];
  for (const s of segmentos) {
    let resto = s.length;
    while (resto >= 255) { tabela.push(255); resto -= 255; }
    tabela.push(resto);
  }
  const corpo = segmentos.reduce((n, s) => n + s.length, 0);
  const pagina = new Uint8Array(27 + tabela.length + corpo);
  const dv = new DataView(pagina.buffer);

  pagina.set([0x4f, 0x67, 0x67, 0x53], 0);       // "OggS"
  pagina[4] = 0;                                  // versão
  pagina[5] = (inicio ? 0x02 : 0) | (fim ? 0x04 : 0);
  // granulepos (64 bits, little-endian)
  dv.setUint32(6, granulos >>> 0, true);
  dv.setUint32(10, Math.floor(granulos / 4294967296), true);
  dv.setUint32(14, 0x00005741, true);             // serial fixo
  dv.setUint32(18, numeroPagina, true);
  dv.setUint32(22, 0, true);                      // checksum (calculado depois)
  pagina[26] = tabela.length;
  pagina.set(tabela, 27);

  let off = 27 + tabela.length;
  for (const s of segmentos) { pagina.set(s, off); off += s.length; }

  dv.setUint32(22, crc32Ogg(pagina), true);
  return pagina;
}

function cabecalhoOpus(canais: number, taxa: number): Uint8Array {
  const h = new Uint8Array(19);
  const dv = new DataView(h.buffer);
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
  h[8] = 1;              // versão
  h[9] = canais;
  dv.setUint16(10, 312, true); // pre-skip
  dv.setUint32(12, taxa, true);
  dv.setUint16(16, 0, true);   // ganho
  h[18] = 0;                   // mapeamento
  return h;
}

function tagsOpus(): Uint8Array {
  const fornecedor = new TextEncoder().encode('bftecmazza-crm');
  const t = new Uint8Array(8 + 4 + fornecedor.length + 4);
  const dv = new DataView(t.buffer);
  t.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); // "OpusTags"
  dv.setUint32(8, fornecedor.length, true);
  t.set(fornecedor, 12);
  dv.setUint32(12 + fornecedor.length, 0, true); // sem comentários
  return t;
}

/** Duração de um quadro Opus em amostras (48 kHz), lida do TOC. */
function amostrasDoQuadro(q: Uint8Array): number {
  if (!q.length) return 960;
  const config = q[0] >> 3;
  const duracoes = [
    10, 20, 40, 60, 10, 20, 40, 60, 10, 20, 40, 60, // SILK
    10, 20, 10, 20,                                  // Hybrid
    2.5, 5, 10, 20, 2.5, 5, 10, 20, 2.5, 5, 10, 20, 2.5, 5, 10, 20, // CELT
  ];
  return Math.round((duracoes[config] ?? 20) * 48);
}

/**
 * Converte um blob WebM/Opus em Ogg/Opus. Devolve null se o áudio não for Opus
 * ou o arquivo não for legível — quem chama decide o fallback.
 */
export async function webmParaOgg(blob: Blob): Promise<Blob | null> {
  try {
    const dados = new Uint8Array(await blob.arrayBuffer());
    const quadros = extrairQuadrosOpus(dados);
    if (quadros.length === 0) return null;

    const paginas: Uint8Array[] = [];
    let n = 0;
    paginas.push(paginaOgg([cabecalhoOpus(1, 48000)], n++, 0, true, false));
    paginas.push(paginaOgg([tagsOpus()], n++, 0, false, false));

    // Áudio: até 50 quadros por página (limite de 255 segmentos)
    let granulos = 0;
    for (let i = 0; i < quadros.length; i += 50) {
      const lote = quadros.slice(i, i + 50);
      for (const q of lote) granulos += amostrasDoQuadro(q);
      const ultimo = i + 50 >= quadros.length;
      paginas.push(paginaOgg(lote, n++, granulos, false, ultimo));
    }

    return new Blob(paginas as BlobPart[], { type: 'audio/ogg; codecs=opus' });
  } catch {
    return null;
  }
}
