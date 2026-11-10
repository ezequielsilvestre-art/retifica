/* cdrf-core.js — a lógica do programa CDRF (Python) portada para JavaScript.
 *
 * Cada função diz de onde veio (módulo.função do programa). Nada aqui toca
 * na tela: serve ao app e aos testes (node) que comparam com o Python.
 * Todas as listas e regras (questões, opções, colunas, valores padrão)
 * vêm do PACOTE DE CAMPO gerado pelo programa — não há cópia à mão.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CDRF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────── texto (comum.py / VERIFICADOR_IA.py) ─────────
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  const semAcentoRaw = (s) => str(s).normalize('NFD').replace(/\p{Mn}/gu, '');
  const semAcento = (s) => semAcentoRaw(s).toLowerCase();            // comum.sem_acento
  const normTexto = (s) =>                                            // V.norm_texto
    semAcentoRaw(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const soDigitos = (s) => str(s).replace(/\D/g, '');                 // V.so_digitos
  const vazio = (resp, q) => !str(resp[String(q)]).trim();            // cascata._vazio
  const ehPJ = (resp) => semAcento((resp || {})['14']).includes('juridic'); // comum.eh_pj

  // ───────── quadra e código (mapa_ruas.py) ─────────
  const PADRAO_CODIGO = /^(\d+)([A-Za-z]{1,3})(\d+)$/;
  const ehAlnum = (c) => /[\p{L}\p{N}]/u.test(c);
  const ehLetra = (c) => /\p{L}/u.test(c);
  const ehDigito = (c) => /\d/.test(c);

  function normalizarQuadra(q) {
    const s = Array.from(str(q).trim().toUpperCase()).filter(ehAlnum).join('');
    const letras = Array.from(s).filter(ehLetra).join('');
    const digitos = Array.from(s).filter(ehDigito).join('');
    if (!letras) return '';
    return (digitos ? digitos[digitos.length - 1] : '0') + letras;
  }
  function quadraVisivel(q) {
    const s = normalizarQuadra(q);
    return s.startsWith('0') ? s.slice(1) : s;
  }
  function nuicDoCodigo(codigo) {
    const s = str(codigo).trim();
    return s.length >= 2 && /^\d\d/.test(s) ? s.slice(0, 2) : '';
  }
  // devolve [quadra|null, lote|null]
  function quadraLoteDoCodigo(codigo) {
    const m = PADRAO_CODIGO.exec(str(codigo).trim());
    if (!m) return [null, null];
    const quadra = (m[1].slice(2, 3) || '0') + m[2].toUpperCase();
    const dg = m[3];
    const lote = parseInt(dg.length >= 2 ? dg.slice(0, 2) : dg, 10);
    return [quadra, Number.isNaN(lote) ? null : lote];
  }
  function montarCodigo(nuic, quadra, lote, edif) {
    if (edif === undefined) edif = '01';
    const n = soDigitos(nuic).slice(0, 2).padStart(2, '0');
    const q = normalizarQuadra(quadra);
    const lo = soDigitos(lote).slice(0, 2).padStart(2, '0');
    const ed = soDigitos(edif).slice(0, 2);
    return n + q + lo + (ed ? ed.padStart(2, '0') : '');
  }
  // V.lote_quadra_do_codigo
  function loteQuadraDoCodigo(codigo) {
    const m = PADRAO_CODIGO.exec(str(codigo).trim());
    if (!m) return '';
    const [quadra] = quadraLoteDoCodigo(codigo);
    const dg = m[3];
    const lote = dg.length >= 2 ? dg.slice(0, 2) : dg;
    return `Lote ${lote} - Quadra ${quadraVisivel(quadra)}`;
  }

  // ───────── município/núcleo (municipios.py) ─────────
  const chaveNucleo = (m, n) => `${str(m).trim()}|${str(n).trim()}`;
  function partesDaChave(k) {
    const s = str(k);
    const i = s.indexOf('|');
    if (i >= 0) return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    return ['', s.trim()];
  }
  function nucleosDoNuic(d, nuic) {
    return Object.entries(d.nucleos || {}).filter(([k]) => partesDaChave(k)[1] === str(nuic));
  }
  function nucleoDoCodigo(d, codigo, municipio) {
    const nuic = nuicDoCodigo(codigo);
    if (!nuic) return null;
    const nucs = d.nucleos || {};
    if (municipio) {
      const a = nucs[chaveNucleo(municipio, nuic)];
      if (a) return a;
    }
    const c = nucleosDoNuic(d, nuic);
    return c.length === 1 ? c[0][1] : null;
  }
  // municipios.mapa_nucleos_nomes
  function mapaNucleosNomes(d, municipio) {
    const fora = new Set();
    const out = {};
    for (const [k, info] of Object.entries(d.nucleos || {})) {
      const [mun, nuic] = partesDaChave(k);
      if (municipio) {
        if (mun === municipio) out[nuic] = (info || {}).nome || '';
      } else if (nuic in out) fora.add(nuic);
      else out[nuic] = (info || {}).nome || '';
    }
    for (const n of fora) delete out[n];
    return out;
  }

  // ───────── mapa de ruas (mapa_ruas.py) ─────────
  const quadrasDoNucleo = (mapa, chave) =>
    ((((mapa.nucleos || {})[str(chave).trim()] || {}).quadras) || {});
  function faixasDaQuadra(mapa, quadra, chave) {
    const qd = normalizarQuadra(quadra) || str(quadra).toUpperCase();
    if (chave !== null && chave !== undefined) return (quadrasDoNucleo(mapa, chave)[qd] || []).slice();
    let out = [];
    for (const info of Object.values(mapa.nucleos || {})) out = out.concat((info.quadras || {})[qd] || []);
    return out;
  }
  function faixaDoLote(mapa, quadra, lote, chave) {
    if (lote === null || lote === undefined) return null;
    for (const fx of faixasDaQuadra(mapa, quadra, chave)) {
      const ini = parseInt(fx.lote_ini, 10), fim = parseInt(fx.lote_fim, 10);
      if (Number.isNaN(ini) || Number.isNaN(fim)) continue;
      if (ini <= lote && lote <= fim) return fx;
    }
    return null;
  }
  function nucleosComOLote(mapa, nuic, quadra, lote) {
    const ach = [];
    for (const k of Object.keys(mapa.nucleos || {})) {
      if (k.split('|').pop() !== str(nuic)) continue;
      if (faixaDoLote(mapa, quadra, lote, k) !== null) ach.push(k);
    }
    return ach;
  }
  // devolve {faixa, quadra, lote}
  function enderecoDoCodigo(mapa, codigo, municipio) {
    const [quadra, lote] = quadraLoteDoCodigo(codigo);
    if (quadra === null) return { faixa: null, quadra: null, lote: null };
    const nuic = nuicDoCodigo(codigo);
    if (municipio) {
      return { faixa: faixaDoLote(mapa, quadra, lote, chaveNucleo(municipio, nuic)), quadra, lote };
    }
    const c = nucleosComOLote(mapa, nuic, quadra, lote);
    if (c.length === 1) return { faixa: faixaDoLote(mapa, quadra, lote, c[0]), quadra, lote };
    return { faixa: null, quadra, lote };
  }

  const CAMPOS_FAIXA = ['lote_ini', 'lote_fim', 'rua', 'bairro', 'cep', 'cidade', 'estado'];

  // ───────── cascata (cascata.py) ─────────
  const IMOVEL_DO_MAPA = [[52, 'rua'], [56, 'bairro'], [57, 'cidade'], [58, 'estado'], [59, 'cep']];
  const dois = (n) => String(n).padStart(2, '0');

  // devolve {respostas, origens, faltou}
  function cascataAplicar(P, codigo, opc) {
    opc = opc || {};
    const respostas = Object.assign({}, opc.respostas || {});
    const origens = {}, faltou = [];
    const mapa = P.mapa, dM = P.municipios, padrao = opc.padrao || P.padrao || {};
    let municipio = opc.municipio || null;
    codigo = str(codigo).trim().toUpperCase();
    if (!codigo) return { respostas, origens, faltou: ['código do cadastro'] };

    // 1. o que o próprio código diz
    const [quadra, lote] = quadraLoteDoCodigo(codigo);
    if (vazio(respostas, 1)) { respostas['1'] = codigo; origens['1'] = 'o código que você digitou'; }
    if (quadra && lote !== null && vazio(respostas, 2)) {
      respostas['2'] = loteQuadraDoCodigo(codigo); origens['2'] = 'o código do cadastro';
    }
    // 2. município e núcleo
    const nuc = nucleoDoCodigo(dM, codigo, municipio);
    if (!municipio) municipio = (nuc || {}).municipio || '';
    if (!municipio) faltou.push('município do núcleo (escolha o núcleo na tela inicial)');

    // 3. endereço do IMÓVEL, pelo mapa de ruas
    let faixa = null;
    if (quadra && lote !== null) faixa = enderecoDoCodigo(mapa, codigo, municipio || null).faixa;
    if (faixa) {
      for (const [q, campo] of IMOVEL_DO_MAPA) {
        const v = str(faixa[campo]).trim();
        if (v && vazio(respostas, q)) {
          respostas[String(q)] = v;
          origens[String(q)] = `mapa de ruas · quadra ${quadraVisivel(quadra)}, lote ${dois(lote)}`;
        }
      }
      for (const q of [54, 55]) {
        if (vazio(respostas, q)) { respostas[String(q)] = '***'; origens[String(q)] = 'não se aplica em lote de casa'; }
      }
    } else {
      faltou.push(`endereço do imóvel — a quadra ${quadra ? quadraVisivel(quadra) : '?'} não tem rua ` +
        'cadastrada para este lote (cadastre no menu 3 do programa, no PC)');
    }
    // 4. estado do município, se o mapa não trouxe
    const mun = ((dM.municipios || {})[municipio || '']) || {};
    if (vazio(respostas, 57) && municipio) { respostas['57'] = municipio; origens['57'] = 'município do núcleo'; }
    if (vazio(respostas, 58) && mun.estado) { respostas['58'] = mun.estado; origens['58'] = 'estado do município'; }
    // 5. valores padrão do loteamento
    for (const [chave, q] of P.q_padrao) {
      const v = str(padrao[chave]).trim();
      if (v && vazio(respostas, q)) {
        respostas[String(q)] = v; origens[String(q)] = 'valor padrão do loteamento (Configurações)';
      }
    }
    return { respostas, origens, faltou };
  }
  function dadosDoNucleo(P, codigo, municipio) {
    const [quadra, lote] = quadraLoteDoCodigo(codigo);
    const nuc = nucleoDoCodigo(P.municipios, codigo, municipio) || {};
    return { municipio: municipio || nuc.municipio || '', nucleo: nuc.nome || '',
      nuic: nuicDoCodigo(codigo), quadra: quadra ? quadraVisivel(quadra) : '', lote };
  }


  // ───────── padronizar (padronizar.py · padronizar_res) ─────────
  const PLACEHOLDERS_DATA = ['01/01/0000', '00/00/0000', '0/0/0', '01/01/1900', '00/00/00'];
  const semEsp = (s) => semAcento(s).replace(/\s+/g, ' ').trim();
  const Q_FMT_TEL = [4, 18], Q_FMT_CEP = [38, 59], Q_FMT_CPF = [8, 22];
  // Limpa as respostas de UM cadastro, em memória. Devolve quantos campos mudaram.
  function padronizarRespostas(P, resp) {
    const ec = resp['14'] || '', pj = ehPJ(resp);
    let n = 0;
    for (const q of Object.keys(resp)) {
      const qi = parseInt(q, 10);
      if (Number.isNaN(qi)) continue;
      let v = str(resp[q]).trim();
      v = corrigirDic(P, qi, v);
      if (!v || v === '***') { if (resp[q] !== v) { resp[q] = v; n++; } continue; }
      const def = P.questoes[String(qi)] || {};
      let novo;
      if (qi === 5 || qi === 19) novo = resolverNacionalidade(v, ec, resp[qi === 5 ? '3' : '17'])[0];
      else if (def.tipo === 'select') {
        const canon = {};
        (def.opcoes || []).forEach((op) => { canon[semEsp(op)] = op; });
        novo = canon[semEsp(v)] !== undefined ? canon[semEsp(v)] : v;
      } else if (P.q_escrita_padrao.includes(qi)) novo = escritaPadrao(P, v);
      else if (P.q_minuscula.includes(qi)) novo = v.toLowerCase();
      else if (Q_FMT_CPF.includes(qi)) novo = (pj && qi === 8) ? mascaraValor('cnpj', v) : mascaraValor('cpf', v);
      else if (Q_FMT_CEP.includes(qi)) novo = mascaraValor('cep', v);
      else if (Q_FMT_TEL.includes(qi)) novo = mascaraValor('tel', v);
      else if (def.tipo === 'data' && PLACEHOLDERS_DATA.includes(v)) novo = '';
      else novo = v.replace(/\s+/g, ' ').trim();
      if (novo !== v) { resp[q] = novo; n++; }
    }
    return n;
  }

  // mapa_ruas.resumo_cobertura + os lotes sem rua dentro do intervalo
  function resumoCobertura(faixas) {
    const nums = [];
    faixas.forEach((fx) => {
      const a = parseInt(fx.lote_ini, 10), b = parseInt(fx.lote_fim, 10);
      if (!Number.isNaN(a) && !Number.isNaN(b)) nums.push(a, b);
    });
    if (!nums.length) return { texto: 'nenhum lote', min: null, max: null, buracos: [] };
    const min = Math.min(...nums), max = Math.max(...nums);
    const cobertos = new Set();
    faixas.forEach((fx) => {
      const a = parseInt(fx.lote_ini, 10), b = parseInt(fx.lote_fim, 10);
      if (Number.isNaN(a) || Number.isNaN(b)) return;
      for (let i = a; i <= b; i++) cobertos.add(i);
    });
    const buracos = [];
    for (let i = min; i <= max; i++) if (!cobertos.has(i)) buracos.push(i);
    return { texto: `lotes ${dois(min)}–${dois(max)}`, min, max, buracos };
  }

  // mapa_ruas.problemas_das_faixas — avisos de faixa inválida ou sobreposta
  function problemasDasFaixas(faixas) {
    const avisos = [], validas = [];
    for (const fx of faixas) {
      const ini = parseInt(fx.lote_ini, 10), fim = parseInt(fx.lote_fim, 10);
      if (Number.isNaN(ini) || Number.isNaN(fim)) { avisos.push(`Faixa com lotes inválidos: ${fx.rua || '?'}`); continue; }
      if (ini > fim) { avisos.push(`Lote inicial maior que o final em: ${fx.rua || '?'} (${ini}–${fim})`); continue; }
      validas.push([ini, fim, fx.rua || '?']);
    }
    validas.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 0; i + 1 < validas.length; i++) {
      const [i1, f1, r1] = validas[i], [i2, f2, r2] = validas[i + 1];
      if (i2 <= f1) avisos.push(`Faixas sobrepostas: '${r1}' (${dois(i1)}–${dois(f1)}) e '${r2}' (${dois(i2)}–${dois(f2)})`);
    }
    return avisos;
  }

  // ───────── validações e máscaras (VERIFICADOR_IA.py, MENU.py) ─────────
  function validaCpf(cpf) {
    const d = soDigitos(cpf);
    if (d.length !== 11 || d === d[0].repeat(11)) return false;
    for (const n of [9, 10]) {
      let soma = 0;
      for (let i = 0; i < n; i++) soma += parseInt(d[i], 10) * (n + 1 - i);
      if (((soma * 10) % 11) % 10 !== parseInt(d[n], 10)) return false;
    }
    return true;
  }
  function validaCnpj(cnpj) {
    const d = soDigitos(cnpj);
    if (d.length !== 14 || d === d[0].repeat(14)) return false;
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    for (const [pesos, n] of [[p1, 12], [p2, 13]]) {
      let soma = 0;
      for (let i = 0; i < n; i++) soma += parseInt(d[i], 10) * pesos[i];
      const r = soma % 11, dv = r < 2 ? 0 : 11 - r;
      if (dv !== parseInt(d[n], 10)) return false;
    }
    return true;
  }
  function normData(s) {
    s = str(s).trim();
    let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return `${dois(parseInt(m[3], 10))}/${dois(parseInt(m[2], 10))}/${m[1]}`;
    m = /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(s);
    if (m) {
      let ano = m[3];
      if (ano.length === 2) ano = (parseInt(ano, 10) > 30 ? '19' : '20') + ano;
      return `${dois(parseInt(m[1], 10))}/${dois(parseInt(m[2], 10))}/${ano}`;
    }
    return '';
  }
  function dataValida(s) {            // V.data_para_date != None
    const d = normData(s);
    if (!d) return false;
    const dia = parseInt(d.slice(0, 2), 10), mes = parseInt(d.slice(3, 5), 10), ano = parseInt(d.slice(6), 10);
    if (!(ano >= 1 && ano <= 9999) || mes < 1 || mes > 12 || dia < 1) return false;
    const bis = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
    const dm = [31, bis ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
    return dia <= dm;
  }
  function mascaraValor(tipo, texto) {
    let d = soDigitos(texto);
    if (!d) return '';
    if (tipo === 'cpf') {
      d = d.slice(0, 11); let o = d.slice(0, 3);
      if (d.length > 3) o += '.' + d.slice(3, 6);
      if (d.length > 6) o += '.' + d.slice(6, 9);
      if (d.length > 9) o += '-' + d.slice(9, 11);
      return o;
    }
    if (tipo === 'cnpj') {
      d = d.slice(0, 14); let o = d.slice(0, 2);
      if (d.length > 2) o += '.' + d.slice(2, 5);
      if (d.length > 5) o += '.' + d.slice(5, 8);
      if (d.length > 8) o += '/' + d.slice(8, 12);
      if (d.length > 12) o += '-' + d.slice(12, 14);
      return o;
    }
    if (tipo === 'cep') { d = d.slice(0, 8); return d.length <= 5 ? d : d.slice(0, 5) + '-' + d.slice(5); }
    if (tipo === 'data') {
      d = d.slice(0, 8); let o = d.slice(0, 2);
      if (d.length > 2) o += '/' + d.slice(2, 4);
      if (d.length > 4) o += '/' + d.slice(4, 8);
      return o;
    }
    if (tipo === 'tel') {
      d = d.slice(0, 11);
      if (d.length < 3) return '(' + d;
      const r = d.slice(2), head = '(' + d.slice(0, 2) + ') ';
      if (d.length === 11) return head + r[0] + ' ' + r.slice(1, 5) + '-' + r.slice(5);
      if (r.length > 4) return head + r.slice(0, -4) + '-' + r.slice(-4);
      return head + r;
    }
    return str(texto);
  }
  // cor da borda: 'ok' | 'erro' | 'neutro'  (MENU.cor_valor)
  function corValor(tipo, texto) {
    const d = soDigitos(texto);
    if (!d) return 'neutro';
    const ok = (b) => (b ? 'ok' : 'erro');
    if (tipo === 'cpf') return ok(d.length === 11 && validaCpf(d));
    if (tipo === 'cnpj') return ok(d.length === 14 && validaCnpj(d));
    if (tipo === 'cep') return ok(d.length === 8);
    if (tipo === 'tel') return ok(d.length === 10 || d.length === 11);
    if (tipo === 'data') return ok(d.length === 8 && dataValida(texto));
    return 'neutro';
  }
  // opcoes_cdrf.validar → mensagem ou null
  function validarQuestao(P, q, valor) {
    const v = str(valor).trim();
    if (!v) return null;
    const t = P.questoes[String(q)].tipo, dig = soDigitos(v);
    if (t === 'data') { if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return 'Data deve ser dd/mm/aaaa'; }
    else if (t === 'cpf') { if (dig.length !== 11) return 'CPF precisa de 11 dígitos'; }
    else if (t === 'cep') { if (dig.length !== 8) return 'CEP precisa de 8 dígitos'; }
    else if (t === 'tel') { if (dig.length !== 10 && dig.length !== 11) return 'Telefone precisa de 10 ou 11 dígitos (com DDD)'; }
    else if (t === 'num') { if (!dig) return 'Digite um número'; }
    return null;
  }

  // ───────── escrita padrão e gênero (VERIFICADOR_IA.py) ─────────
  function escritaPadrao(P, s) {
    s = str(s);
    if (!s.trim()) return s;
    if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;      // já veio misto
    const min = new Set(P.palavras_minusculas);
    return s.trim().split(/\s+/).map((p, i) => {
      const pl = p.toLowerCase();
      return i > 0 && min.has(pl) ? pl : pl.slice(0, 1).toUpperCase() + pl.slice(1);
    }).join(' ');
  }
  const formatarTelefone = (s) => { const d = soDigitos(s);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d[2]} ${d.slice(3, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return str(s); };
  const formatarCep = (s) => { const d = soDigitos(s); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : str(s); };
  const formatarCpf = (s) => { const d = soDigitos(s);
    return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : str(s); };
  const formatarCnpj = (s) => { const d = soDigitos(s);
    return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : str(s); };

  function classificarEstadoCivil(texto) {
    const t = normTexto(texto);
    if (!t) return '';
    if (t.includes('juridic')) return 'pessoa juridica';
    if (t.includes('casad') && !t.includes('uniao')) return 'casado';
    if (t.includes('uniao') || t.includes('estavel') || t.includes('amasiad')) return 'uniao estavel';
    if (t.includes('solteir')) return 'solteiro';
    if (t.includes('divorciad')) return 'divorciado';
    if (t.includes('separad')) return 'separado';
    if (t.includes('viuv')) return 'viuvo';
    return '';
  }
  function generoEstadoCivil(ec) {
    const t = normTexto(ec);
    if (!t) return null;
    const low = str(ec).toLowerCase();
    const combinado = low.includes('(a)') || low.includes('(o)');
    const temF = ['casada', 'solteira', 'divorciada', 'separada', 'viuva'].some((f) => t.includes(f));
    const temM = ['casado', 'solteiro', 'divorciado', 'separado', 'viuvo'].some((m) => t.includes(m));
    if (combinado && temM && !temF) return null;
    if (temF && !temM) return 'f';
    if (temM && !temF) return 'm';
    return null;
  }
  const NOMES_M = new Set(['jose', 'joao', 'luca', 'noe', 'elias', 'isaias', 'jonas', 'tobias', 'matias', 'dinis', 'nicolas', 'lucas', 'thomas']);
  const NOMES_F = new Set(['isabel', 'raquel', 'rute', 'ester', 'miriam', 'carmen', 'ines', 'beatriz', 'mercedes', 'luz', 'iris', 'jaqueline', 'evelin', 'kariny', 'nair', 'ruth', 'lindalva']);
  function generoDoNome(nome) {
    const partes = normTexto(nome).split(' ').filter(Boolean);
    if (!partes.length) return null;
    const n = partes[0];
    if (NOMES_M.has(n)) return 'm';
    if (NOMES_F.has(n)) return 'f';
    if (n.endsWith('a') && !(n.endsWith('sa') || n.endsWith('ca'))) return 'f';
    if (['o', 'os', 'or', 'el', 'il', 'son', 'ton', 'ilton', 'ilson', 'aldo', 'ardo'].some((x) => n.endsWith(x))) return 'm';
    return null;
  }
  // devolve [valor, aviso|null]
  function resolverNacionalidade(valor, estadoCivil, nome) {
    const v = str(valor), t = normTexto(v);
    let fem, masc;
    if (t.includes('brasil')) { fem = 'brasileira'; masc = 'brasileiro'; }
    else if (t.includes('estrangeir')) { fem = 'estrangeira'; masc = 'estrangeiro'; }
    else return [v, null];
    const low = v.toLowerCase();
    const combinado = low.includes('(a)') || low.includes('(o)') || t.includes('/a') || t.includes('/o') ||
      t.endsWith(' a') || t.endsWith(' o');
    if (!combinado) return [t.endsWith('a') ? fem : masc, null];
    let g = generoEstadoCivil(estadoCivil);
    if (g === 'f') return [fem, null];
    if (g === 'm') return [masc, null];
    g = generoDoNome(nome);
    if (g === 'f') return [fem, 'gênero deduzido do nome — conferir'];
    if (g === 'm') return [masc, 'gênero deduzido do nome — conferir'];
    return [v, 'definir gênero (brasileiro/brasileira) manualmente'];
  }

  // dicionario_texto.corrigir
  const chaveDic = (v) => semAcentoRaw(v).replace(/\s+/g, ' ').trim().toLowerCase();
  function corrigirDic(P, questao, valor) {
    const original = str(valor), k = chaveDic(original);
    if (!k) return original;
    const d = P.dicionario || {};
    const porQ = ((d.por_questao || {})[String(questao)]) || {};
    for (const mapa of [porQ, d.geral || {}]) {
      const norm = {};
      for (const [antes, depois] of Object.entries(mapa)) norm[chaveDic(antes)] = depois;
      if (Object.prototype.hasOwnProperty.call(norm, k)) return str(norm[k]);
    }
    return original;
  }

  // MENU.TelaCorrecao._formatar_texto (campo de texto ao sair/avançar)
  function formatarTexto(P, q, valor, resp) {
    let v = str(valor).trim();
    if (v && v !== '***') {
      v = corrigirDic(P, q, v);
      if (q === 6 || q === 20) v = v.replace(/\s+/g, ' ').toLowerCase();
      else if (q === 5 || q === 19) v = resolverNacionalidade(v, (resp || {})['14'], (resp || {})['3'])[0];
      else if (P.q_escrita_padrao.includes(q)) v = escritaPadrao(P, v);
      else v = v.replace(/\s+/g, ' ');
    }
    return v;
  }

  // ───────── fluxo guiado (MENU.JanelaFoco) ─────────
  function fluxoDeCampos(P, resp) {
    const ec = classificarEstadoCivil(resp['14']);
    const pj = ec === 'pessoa juridica';
    const com = P.tem_companheiro.includes(ec);
    const fora = new Set();
    if (pj) P.fluxo.Q_SO_PESSOA.forEach((q) => fora.add(q));
    else {
      if (!com) { P.fluxo.Q_CONJUGE.forEach((q) => fora.add(q)); P.fluxo.Q_UNIAO.forEach((q) => fora.add(q)); }
      if (ec !== 'casado') P.fluxo.Q_REGIME.forEach((q) => fora.add(q));
    }
    return Object.keys(P.questoes).map(Number).sort((a, b) => a - b).filter((q) => !fora.has(q));
  }
  function dicaDoCampo(P, q, resp) {
    const t = P.questoes[String(q)].tipo;
    if (q === 8 && ehPJ(resp)) return 'CNPJ, só os números — a pontuação entra sozinha';
    return { cpf: 'só os números — a pontuação entra sozinha', cep: 'só os números — o hífen entra sozinho',
      tel: 'com DDD, só os números', data: 'dia, mês e ano — as barras entram sozinhas', num: 'só números',
      select: 'escolha na lista ou digite' }[t] || '';
  }
  function tipoDeMascara(P, q, resp) {
    const t = P.questoes[String(q)].tipo;
    if (['cpf', 'cep', 'tel', 'data'].includes(t)) return q === 8 && ehPJ(resp) ? 'cnpj' : t;
    return null;
  }
  // MENU.JanelaFoco._avancar: valida; devolve mensagem de erro ou null
  function validarAvanco(P, q, val, resp) {
    val = str(val).trim();
    if (q === 8 && val && ehPJ(resp)) return validaCnpj(val) ? null : 'CNPJ precisa de 14 dígitos válidos';
    return val ? validarQuestao(P, q, val) : null;
  }

  // ───────── sugestões (MENU.TelaCorrecao._valores_existentes/_opcoes_campo) ─────────
  function grupoDoCampo(P, q) {
    for (const [nome, qs] of Object.entries(P.grupos_campo)) if (qs.includes(q)) return nome;
    return null;
  }
  // cadastros = lista de {respostas}; incluídos os do próprio aparelho
  function valoresExistentes(P, q, cadastros) {
    const grupo = grupoDoCampo(P, q);
    const irmaos = grupo ? P.grupos_campo[grupo] : [q];
    const vals = new Set();
    for (const c of cadastros || []) {
      for (const qq of irmaos) {
        const v = str((c.respostas || {})[String(qq)]).trim();
        if (v && v !== '***') vals.add(v);
      }
    }
    if (grupo) {
      (P.sugestoes_grupo[grupo] || []).forEach((v) => vals.add(v));
      (P.catalogo[grupo] || []).forEach((v) => vals.add(v));
    } else if (P.questoes[String(q)].extensivel) {
      (P.sugestoes_extensiveis[String(q)] || []).forEach((v) => vals.add(v));
    }
    return Array.from(vals).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  function opcoesDoCampo(P, q, cadastros) {
    const base = (P.questoes[String(q)].opcoes || []).slice();
    if (P.questoes[String(q)].extensivel) {
      const vistos = new Set(base.map((x) => semAcento(x).trim()));
      for (const x of valoresExistentes(P, q, cadastros)) if (!vistos.has(semAcento(x).trim())) base.push(x);
    }
    return base;
  }
  // MENU.wire_autocomplete: até 8 sugestões, sem acento
  function sugerir(valores, texto) {
    const txt = semAcento(texto).trim();
    if (!txt) return [];
    const ach = valores.filter((v) => semAcento(v).includes(txt)).slice(0, 8);
    if (!ach.length || (ach.length === 1 && semAcento(ach[0]) === txt)) return [];
    return ach;
  }

  // ───────── planilha (VERIFICADOR_IA.gerar_planilha, padronizar=True) ─────────
  function linhaDoBanco(P, resp, nucleosMap, nucleoNome) {
    const codigo = str(resp['1']);
    const pj = classificarEstadoCivil(resp['14']) === 'pessoa juridica';
    const [qd, lt] = quadraLoteDoCodigo(codigo);
    const quadraL = qd === null ? '' : quadraVisivel(qd);
    const loteN = qd === null ? '' : (lt === null ? '' : lt);
    const linha = [];
    P.colunas.forEach(([cab, q]) => {
      if (cab === '(1) Id.Registro') linha.push('');
      else if (q === 'NUCLEO') linha.push(nucleosMap ? (nucleosMap[codigo.slice(0, 2)] !== undefined ? nucleosMap[codigo.slice(0, 2)] : nucleoNome) : nucleoNome);
      else if (q === 'QUADRA') linha.push(quadraL);
      else if (q === 'LOTE') linha.push(loteN);
      else if (q === 'NUNID') linha.push(codigo ? 1 : '');
      else if (q === null) linha.push('');
      else {
        let v = corrigirDic(P, q, resp[String(q)]);
        if (P.q_escrita_padrao.includes(q)) v = escritaPadrao(P, v);
        else if (P.q_minuscula.includes(q)) v = str(v).toLowerCase();
        else if (q === 4 || q === 18) v = formatarTelefone(v);
        else if (q === 38 || q === 59) v = formatarCep(v);
        else if (q === 8 || q === 22) v = (q === 8 && pj) ? formatarCnpj(v) : formatarCpf(v);
        linha.push(v);
      }
    });
    return linha;
  }
  // cadastros: {codigo: {respostas}} → abas prontas para criarXlsx
  function abasDaPlanilha(P, cadastros, municipio) {
    const nucleosMap = mapaNucleosNomes(P.municipios, municipio || null);
    const cabec = P.colunas.map(([c]) => ' ' + c);
    const codigos = Object.keys(cadastros).sort();
    const linhas = codigos.map((c) => linhaDoBanco(P, cadastros[c].respostas || {}, nucleosMap, ''));
    const larg = cabec.map((c, i) => {
      let m = c.length;
      for (const l of linhas) m = Math.max(m, str(l[i]).length);
      return Math.min(Math.max(m + 2, 10), 42);
    });
    return [
      { nome: 'REGULARIZAÇÃO FUNDIÁRIA', cabecalho: cabec, linhas, larguras: larg, congelar: { linhas: 1, colunas: 2 } },
      { nome: 'PENDÊNCIAS', cabecalho: ['Cadastro', 'Tipo', 'Campo / Questão', 'Valor na ficha', 'Valor no documento',
        'Arquivo(s)', 'Observação', 'Confiança / Origem'], linhas: [], larguras: [12, 14, 28, 28, 28, 24, 44, 22],
        congelar: { linhas: 1, colunas: 0 } },
    ];
  }

  return {
    str, semAcento, normTexto, soDigitos, ehPJ, vazio,
    normalizarQuadra, quadraVisivel, nuicDoCodigo, quadraLoteDoCodigo, montarCodigo, loteQuadraDoCodigo,
    chaveNucleo, partesDaChave, nucleoDoCodigo, mapaNucleosNomes, enderecoDoCodigo,
    cascataAplicar, dadosDoNucleo, padronizarRespostas, problemasDasFaixas, resumoCobertura,
    quadrasDoNucleo, faixasDaQuadra, faixaDoLote, CAMPOS_FAIXA,
    validaCpf, validaCnpj, normData, dataValida, mascaraValor, corValor, validarQuestao,
    escritaPadrao, classificarEstadoCivil, resolverNacionalidade, corrigirDic, formatarTexto,
    fluxoDeCampos, dicaDoCampo, tipoDeMascara, validarAvanco,
    grupoDoCampo, valoresExistentes, opcoesDoCampo, sugerir,
    linhaDoBanco, abasDaPlanilha,
  };
});
