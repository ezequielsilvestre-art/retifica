/* aprender.js — RECEBER UMA PLANILHA PRONTA (formato do banco do CDRF) e
 * aprender com ela tudo o que dá para configurar, sem pacote nenhum:
 *
 *   municípios e dados da prefeitura · núcleos (NUIC e nome) · ruas por
 *   faixa de lotes · valores padrão do núcleo · códigos já usados ·
 *   sugestões de preenchimento · os próprios cadastros.
 *
 * Nada é gravado aqui. `aprender` lê; `comparar` diz o que MUDARIA no que já
 * existe (configuração e cadastros do mesmo município/núcleo), item por item,
 * já com a sugestão de marcar ou não. Quem aplica é a tela, depois que você
 * decide. As regras de detecção são as do programa do PC
 * (municipios.detectar_da_planilha, mapa_ruas.montar_faixas).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cdrf-core.js'));
  else root.CDRF_APRENDER = factory(root.CDRF);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const str = C.str;

  // municipios.PLACEHOLDERS / eh_placeholder
  const PLACEHOLDERS = new Set(['', '***', '**', '*', '-', '--', '---', '_', '__', 'n/a', 'na', 'nao se aplica',
    'nao informado', 'sem informacao', '?', '??', '...', '.', '0', 'x', 'xx', 'xxx', 'nulo', 'null', 'none',
    'vazio', 's/n', 'sn']);
  function ehPlaceholder(s) {
    const t = C.semAcento(str(s)).trim();
    if (PLACEHOLDERS.has(t)) return true;
    return !!t && !/[\p{L}\p{N}]/u.test(t);
  }
  const util = (s) => (ehPlaceholder(s) ? '' : str(s).trim());

  // Counter.most_common(1): a mais usada; empate fica com a que apareceu primeiro
  function maisUsada(cont) {
    let melhor = null, n = -1;
    for (const [k, v] of cont) if (v > n) { melhor = k; n = v; }
    return melhor;
  }
  // mapa_ruas._melhor_grafia: empate = a mais completa
  function melhorGrafia(cont) {
    let maior = 0;
    for (const v of cont.values()) maior = Math.max(maior, v);
    const cand = Array.from(cont.entries()).filter(([, v]) => v === maior).map(([k]) => k);
    cand.sort((a, b) => (b.length - a.length) || (a < b ? 1 : a > b ? -1 : 0));
    return cand[0];
  }
  const contar = (m, k) => m.set(k, (m.get(k) || 0) + 1);

  // ───────── 1. a tabela: cabeçalho "(N) ..." → coluna ─────────
  function tabelaDoBanco(linhas) {
    const cab = (linhas && linhas[0]) || [];
    const col = {};
    cab.forEach((h, i) => {
      const m = /^\s*\((\d+)\)/.exec(str(h));
      if (m && col[+m[1]] === undefined) col[+m[1]] = i;
    });
    if (col[2] === undefined) {
      throw new Error('Esta planilha não está no formato do banco do CDRF: falta a coluna "(2) Nº Cadastral" na primeira linha.');
    }
    const out = [];
    for (let r = 1; r < linhas.length; r++) {
      const L = linhas[r] || [];
      const v = {};
      for (const [n, i] of Object.entries(col)) {
        const x = str(L[i]).trim();
        if (x) v[n] = x;
      }
      if (!v[2]) continue;
      out.push({ linha: r + 1, v });
    }
    return { colunas: col, linhas: out };
  }

  // comum.ler_planilha_res: uma linha → {respostas, idreg, extras}
  function cadastroDaLinha(P, row) {
    const respostas = {}, extras = {};
    let idreg = '';
    P.colunas.forEach(([, q], i) => {
      const n = i + 1, val = str(row.v[n]).trim();
      if (!val) return;
      if (n === 1) idreg = val;
      else if (typeof q === 'number') respostas[String(q)] = val;
      else if (q === null) extras[String(n)] = val;
    });
    return { codigo: str(row.v[2]).trim().toUpperCase(), respostas, idreg, extras };
  }

  // ───────── 2. ruas (mapa_ruas.norm_rua + montar_faixas) ─────────
  const PREFIXOS = ['rua ', 'r ', 'avenida ', 'av ', 'travessa ', 'tv ', 'praca ', 'pc ', 'alameda ', 'al ',
    'estrada ', 'est ', 'rodovia ', 'rod ', 'largo ', 'beco ', 'viela ', 'loteamento '];
  function normRua(s) {
    let t = C.semAcento(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
    for (const p of PREFIXOS) if (t.startsWith(p)) { t = t.slice(p.length); break; }
    return t.trim();
  }
  const dois = (n) => String(n).padStart(2, '0');
  function montarFaixas(linhas, avisos) {
    const graf = new Map();
    for (const l of linhas) { const k = normRua(l.rua); if (!graf.has(k)) graf.set(k, new Map()); contar(graf.get(k), l.rua); }
    const oficial = {};
    for (const [k, c] of graf) {
      oficial[k] = melhorGrafia(c);
      if (c.size > 1) {
        const outras = Array.from(c.keys()).filter((x) => x !== oficial[k]);
        avisos.push(`'${oficial[k]}' aparece também como ${outras.map((o) => `'${o}'`).join(', ')} — juntados`);
      }
    }
    const bairros = new Set(linhas.map((l) => C.semAcento(l.bairro)).filter(Boolean));
    for (const [k, of] of Object.entries(oficial)) {
      if (k && bairros.has(C.semAcento(of))) avisos.push(`'${of}' está no campo do logradouro mas também é o nome de um bairro — pode ser preenchimento errado`);
    }
    const porQuadra = new Map();
    for (const l of linhas) {
      if (!porQuadra.has(l.quadra)) porQuadra.set(l.quadra, []);
      porQuadra.get(l.quadra).push(l);
    }
    const faixas = {};
    for (const [quadra, itens] of porQuadra) {
      const porLote = new Map();
      for (const l of itens) { if (!porLote.has(l.lote)) porLote.set(l.lote, new Set()); porLote.get(l.lote).add(normRua(l.rua)); }
      for (const [lote, krs] of Array.from(porLote.entries()).sort((a, b) => a[0] - b[0])) {
        if (krs.size > 1) avisos.push(`quadra ${C.quadraVisivel(quadra)}, lote ${dois(lote)}: aparece com mais de uma rua (${Array.from(krs).sort().map((k) => `'${oficial[k]}'`).join(', ')}) — usei a primeira`);
      }
      // o mesmo lote em duas linhas: vale a primeira na ordem (lote, rua, …), como o sorted() do Python
      const ordenados = itens.slice().sort((a, b) => (a.lote - b.lote) || cmp(normRua(a.rua), normRua(b.rua))
        || cmp(a.bairro, b.bairro) || cmp(a.cep, b.cep) || cmp(a.cidade, b.cidade) || cmp(a.estado, b.estado));
      const vistos = new Map();
      for (const l of ordenados) if (!vistos.has(l.lote)) vistos.set(l.lote, l);
      const saida = [];
      let atual = null;
      for (const lote of Array.from(vistos.keys()).sort((a, b) => a - b)) {
        const l = vistos.get(lote), kr = normRua(l.rua);
        if (atual && atual._k === kr) {
          atual.lote_fim = lote; atual._lotes.push(lote); contar(atual._ceps, l.cep); contar(atual._bairros, l.bairro);
        } else {
          if (atual) saida.push(atual);
          atual = { _k: kr, lote_ini: lote, lote_fim: lote, rua: oficial[kr], cidade: l.cidade, estado: l.estado,
            _lotes: [lote], _ceps: new Map([[l.cep, 1]]), _bairros: new Map([[l.bairro, 1]]) };
        }
      }
      if (atual) saida.push(atual);
      for (const fx of saida) {
        const sem = [];
        for (let n = fx.lote_ini; n <= fx.lote_fim; n++) if (!fx._lotes.includes(n)) sem.push(n);
        if (sem.length) avisos.push(`quadra ${C.quadraVisivel(quadra)}, ${fx.rua} ${dois(fx.lote_ini)}–${dois(fx.lote_fim)}: os lotes ${sem.map(dois).join(', ')} não têm cadastro na planilha e entraram na faixa por estarem entre lotes desta rua — confira`);
        fx.cep = melhorGrafia(fx._ceps) || '';
        fx.bairro = melhorGrafia(fx._bairros) || '';
        const ceps = Array.from(fx._ceps.keys()).filter(Boolean);
        if (ceps.length > 1) avisos.push(`quadra ${C.quadraVisivel(quadra)}, lotes ${dois(fx.lote_ini)}–${dois(fx.lote_fim)} (${fx.rua}): CEP diferente por lote (${ceps.sort().join(', ')}) — usei ${fx.cep}`);
        delete fx._k; delete fx._ceps; delete fx._bairros; delete fx._lotes;
      }
      faixas[quadra] = saida;
    }
    return faixas;
  }
  const cmp = (a, b) => (str(a) < str(b) ? -1 : str(a) > str(b) ? 1 : 0);

  // ───────── 3. aprender tudo de uma vez ─────────
  // P = regras do programa (questões, colunas…); tabela = tabelaDoBanco(...)
  function aprender(P, tabela) {
    const avisos = [];
    const rows = tabela.linhas;
    const g = (r, n) => str(r.v[n]).trim();

    // municípios: junta as grafias (a mais usada vence)
    const graf = new Map();
    const base = rows.map((r) => {
      const cod = g(r, 2).toUpperCase();
      const munBruto = util(g(r, 63) || g(r, 37));
      if (munBruto) { const k = C.semAcento(munBruto).trim(); if (!graf.has(k)) graf.set(k, new Map()); contar(graf.get(k), munBruto); }
      return { r, cod, nuic: C.nuicDoCodigo(cod), munBruto };
    });
    const canon = {}, contagem = {};
    for (const cont of graf.values()) {
      const of = maisUsada(cont);
      let total = 0;
      for (const [gr, n] of cont) { canon[gr] = of; total += n; }
      contagem[of] = total;
      if (cont.size > 1) {
        const outras = Array.from(cont.entries()).filter(([k]) => k !== of).map(([k, n]) => `${k} (${n}x)`);
        avisos.push(`Município '${of}' aparece também como ${outras.join(', ')} — foram juntados`);
      }
    }
    const munDe = (bruto) => (bruto ? (canon[bruto] || bruto) : '');
    // linha sem município: se na planilha o NUIC dela só aparece com UM município, é dele
    // (o programa do PC também junta por NUIC na planilha-mãe)
    const munsDoNuic = {};
    base.forEach((b) => { const m = munDe(b.munBruto); if (m && b.nuic) (munsDoNuic[b.nuic] = munsDoNuic[b.nuic] || new Set()).add(m); });
    const deduzidos = {};

    const municipios = {}, nucleos = {}, porChave = {}, semMunicipio = [];
    for (const b of base) {
      let mun = munDe(b.munBruto);
      if (!mun && b.nuic && munsDoNuic[b.nuic] && munsDoNuic[b.nuic].size === 1) {
        mun = Array.from(munsDoNuic[b.nuic])[0];
        (deduzidos[mun + '|' + b.nuic] = deduzidos[mun + '|' + b.nuic] || []).push(b.cod);
      }
      b.mun = mun;
      if (mun) {
        const info = (municipios[mun] = municipios[mun] || {});
        const est = util(g(b.r, 64));
        if (est && !info.estado) info.estado = est;
      }
      if (b.nuic && mun) {
        const k = C.chaveNucleo(mun, b.nuic);
        const n = (nucleos[k] = nucleos[k] || { municipio: mun, nuic: b.nuic, nome: '' });
        const nome = util(g(b.r, 73));
        if (nome && !n.nome) n.nome = nome;
        (porChave[k] = porChave[k] || []).push(b);
      } else semMunicipio.push(b.cod);
      // cadastro da prefeitura: o endereço do beneficiário é o da prefeitura
      const ec = C.semAcento(g(b.r, 15)), nome = g(b.r, 4);
      let munPref = munDe(util(g(b.r, 37)));
      if (!munPref) munPref = mun;
      if ((ec.includes('juridic') || nome.toLowerCase().includes('prefeitura')) && munPref && !ehPlaceholder(nome)) {
        const d = (municipios[munPref] = municipios[munPref] || {});
        const novos = { prefeitura: nome, cnpj: g(b.r, 9), logradouro: g(b.r, 34), numero: g(b.r, 35),
          bairro: g(b.r, 36), estado: g(b.r, 38), cep: g(b.r, 39) };
        for (const [c, v] of Object.entries(novos)) if (v && !ehPlaceholder(v)) d[c] = v;
      }
    }
    for (const [k, cods] of Object.entries(deduzidos)) {
      const [m, n] = C.partesDaChave(k);
      avisos.push(`${cods.length} cadastro(s) sem município na planilha foram para ${m} (é o único município do NUIC ${n} nela): ${cods.slice(0, 6).join(', ')}${cods.length > 6 ? '…' : ''}`);
    }
    if (semMunicipio.length) {
      avisos.push(`${semMunicipio.length} cadastro(s) sem município na planilha (colunas 63 e 37) — não dá para saber de qual núcleo são: ${semMunicipio.slice(0, 6).join(', ')}${semMunicipio.length > 6 ? '…' : ''}`);
    }
    // município que aparece em menos de 3 linhas, quando a planilha tem outros: pode ser erro de digitação
    const poucos = Object.keys(contagem).length > 1 ? Object.keys(contagem).filter((m) => contagem[m] < 3) : [];

    // ruas, valores padrão e códigos — por núcleo
    const ruas = {}, padrao = {}, existentes = {};
    for (const [k, lista] of Object.entries(porChave)) {
      const linhasRua = [];
      for (const b of lista) {
        const [quadra, lote] = C.quadraLoteDoCodigo(b.cod);
        if (quadra === null || lote === null) continue;
        const rua = g(b.r, 58);
        if (!rua || rua === '***') continue;
        linhasRua.push({ quadra, lote, rua, bairro: g(b.r, 62), cep: g(b.r, 65), cidade: munDe(util(g(b.r, 63))) || b.mun, estado: g(b.r, 64) });
      }
      const av = [];
      if (linhasRua.length) ruas[k] = montarFaixas(linhasRua, av);
      av.forEach((a) => avisos.push(`${k.replace('|', ' · NUIC ')}: ${a}`));
      existentes[k] = Array.from(new Set(lista.map((b) => b.cod))).sort();
      // valor padrão = o que se repete em pelo menos metade dos cadastros do núcleo
      const pad = {};
      for (const [campo, q] of P.q_padrao || []) {
        const cont = new Map();
        for (const b of lista) {
          const v = C.formaOficial(P, q, g(b.r, colunaDaQuestao(P, q)));
          if (v && v !== '***') contar(cont, v);
        }
        if (!cont.size) continue;
        const top = maisUsada(cont);
        if (cont.get(top) * 2 >= lista.length) pad[campo] = top;
      }
      if (Object.keys(pad).length) padrao[k] = pad;
    }

    // sugestões do autocompletar (nunca nomes de pessoas nem filiação)
    const sugestoes = {}, extensiveis = {};
    for (const [grupo, qs] of Object.entries(P.grupos_campo || {})) {
      if (grupo === 'nome' || grupo === 'filiacao') continue;
      const s = new Set();
      for (const b of base) for (const q of qs) { const v = g(b.r, colunaDaQuestao(P, q)); if (v && v !== '***') s.add(v); }
      if (s.size) sugestoes[grupo] = Array.from(s).sort();
    }
    for (const [qs, def] of Object.entries(P.questoes || {})) {
      if (!def.extensivel) continue;
      const oficiais = new Set((def.opcoes || []).map(C.chaveOpcao));
      const s = new Set();
      for (const b of base) { const v = g(b.r, colunaDaQuestao(P, +qs)); if (v && v !== '***' && !oficiais.has(C.chaveOpcao(v))) s.add(v); }
      if (s.size) extensiveis[qs] = Array.from(s).sort();
    }

    // os cadastros
    const cadastros = base.map((b) => Object.assign({ municipio: b.mun }, cadastroDaLinha(P, b.r)));
    return { municipios, nucleos, ruas, padrao, existentes, sugestoes, extensiveis, cadastros, avisos, poucos,
      total: rows.length };
  }
  function colunaDaQuestao(P, q) {
    if (!P._colDaQ) { P._colDaQ = {}; P.colunas.forEach(([, qq], i) => { if (typeof qq === 'number') P._colDaQ[qq] = i + 1; }); }
    return P._colDaQ[q];
  }

  // ───────── 4. comparar com o que já existe ─────────
  // atual = {municipios:{nome:info}, nucleos:{chave:{municipio,nuic,nome}}, mapa:{nucleos:{chave:{quadras}}},
  //          padrao:(chave)=>{campo:valor}, existentes:{chave:[cod]}, sugestoes:{grupo:[...]},
  //          extensiveis:{q:[...]}, cadastros:[{key, municipio, codigo, respostas, idreg, extras}]}
  // Devolve itens {id, grupo, titulo, atual, novo, marcado, nota, acao}. Marcado = completa o que está
  // vazio ou é novo; DESmarcado = troca algo que já tem valor (você decide).
  const GRUPOS = [
    ['mun', 'Municípios e prefeitura'],
    ['nuc', 'Núcleos'],
    ['rua', 'Ruas (faixas de lotes)'],
    ['pad', 'Valores padrão do núcleo'],
    ['cod', 'Códigos já usados no núcleo'],
    ['sug', 'Sugestões de preenchimento'],
    ['cadnovo', 'Cadastros novos'],
    ['cadvazio', 'Cadastros que já existem — campos vazios a completar'],
    ['cadconf', 'Cadastros que já existem — valor diferente (conflito)'],
    ['graf', 'Grafia fora do padrão do CDRF'],
  ];
  const ROT_MUN = { prefeitura: 'Prefeitura', cnpj: 'CNPJ', logradouro: 'Logradouro', numero: 'Número', bairro: 'Bairro', estado: 'Estado', cep: 'CEP' };
  const rotNuc = (k) => { const [m, n] = C.partesDaChave(k); return `${m} · NUIC ${n}`; };
  const descFaixa = (fx) => `lotes ${dois(fx.lote_ini)}–${dois(fx.lote_fim)}: ${fx.rua || '(sem rua)'}${fx.bairro ? ' · ' + fx.bairro : ''}${fx.cep ? ' · ' + fx.cep : ''}`;
  const colide = (a, b) => {
    const ai = parseInt(a.lote_ini, 10), af = parseInt(a.lote_fim, 10), bi = parseInt(b.lote_ini, 10), bf = parseInt(b.lote_fim, 10);
    if ([ai, af, bi, bf].some(Number.isNaN)) return false;
    return ai <= bf && bi <= af;
  };
  const mesmaFaixa = (a, b) => +a.lote_ini === +b.lote_ini && +a.lote_fim === +b.lote_fim && normRua(a.rua) === normRua(b.rua)
    && C.semAcento(a.bairro) === C.semAcento(b.bairro) && C.soDigitos(a.cep) === C.soDigitos(b.cep);
  const rotQ = (P, q) => `Q${q} ${((P.questoes || {})[String(q)] || {}).rotulo || ''}`.trim();
  const rotCol = (P, n) => (P.colunas[n - 1] || [`(${n})`])[0];
  const vz = (v) => { const t = str(v).trim(); return !t || t === '***'; };

  function comparar(P, prop, atual) {
    const itens = [];
    let seq = 0;
    const add = (grupo, titulo, a, novo, marcado, acao, nota) =>
      itens.push({ id: ++seq, grupo, titulo, atual: a, novo, marcado, acao, nota: nota || '' });

    // municípios
    for (const [nome, dados] of Object.entries(prop.municipios)) {
      const at = (atual.municipios || {})[nome];
      const pouco = prop.poucos.includes(nome);
      const notaPouco = pouco ? 'aparece em menos de 3 linhas — confira se não é erro de digitação' : '';
      if (!at) {
        const det = Object.entries(dados).filter(([, v]) => v).map(([c, v]) => `${ROT_MUN[c] || c}: ${v}`).join(' · ');
        add('mun', `Município novo: ${nome}`, '', det || '(só o nome)', !pouco, { tipo: 'mun_novo', nome, dados }, notaPouco);
        continue;
      }
      for (const [c, v] of Object.entries(dados)) {
        if (!v) continue;
        const a = str(at[c]).trim();
        if (a === v) continue;
        add('mun', `${nome} · ${ROT_MUN[c] || c}`, a, v, !a, { tipo: 'mun_campo', nome, campo: c, valor: v });
      }
    }
    // núcleos
    for (const [k, n] of Object.entries(prop.nucleos)) {
      const at = (atual.nucleos || {})[k];
      if (!at) { add('nuc', `Núcleo novo: ${rotNuc(k)}`, '', n.nome || '(sem nome)', true, { tipo: 'nuc_novo', chave: k, info: n }); continue; }
      if (n.nome && str(at.nome).trim() !== n.nome) {
        add('nuc', `${rotNuc(k)} · nome do núcleo`, at.nome || '', n.nome, !str(at.nome).trim(), { tipo: 'nuc_nome', chave: k, nome: n.nome });
      }
    }
    // ruas
    for (const [k, quadras] of Object.entries(prop.ruas)) {
      const qAt = (((atual.mapa || {}).nucleos || {})[k] || {}).quadras || {};
      for (const [qd, faixas] of Object.entries(quadras)) {
        const existentes = qAt[qd] || [];
        for (const fx of faixas) {
          const bate = existentes.filter((e) => colide(e, fx));
          if (bate.length === 1 && mesmaFaixa(bate[0], fx)) continue;
          const tit = `${rotNuc(k)} · quadra ${C.quadraVisivel(qd)}`;
          if (!bate.length) add('rua', tit, '', descFaixa(fx), true, { tipo: 'rua_nova', chave: k, quadra: qd, faixa: fx });
          else add('rua', tit, bate.map(descFaixa).join(' | '), descFaixa(fx), false, { tipo: 'rua_troca', chave: k, quadra: qd, faixa: fx },
            'substitui a(s) faixa(s) que já cobrem esses lotes');
        }
      }
    }
    // valores padrão
    for (const [k, pad] of Object.entries(prop.padrao)) {
      const at = atual.padrao(k) || {};
      for (const [campo, v] of Object.entries(pad)) {
        const a = str(at[campo]).trim();
        if (a === v) continue;
        const q = ((P.q_padrao || []).find(([c]) => c === campo) || [])[1];
        add('pad', `${rotNuc(k)} · ${q ? rotQ(P, q) : campo}`, a, v, !a, { tipo: 'pad', chave: k, campo, valor: v },
          'é o valor da maioria dos cadastros do núcleo na planilha');
      }
    }
    // códigos já usados
    for (const [k, cods] of Object.entries(prop.existentes)) {
      const ja = new Set((atual.existentes || {})[k] || []);
      const novos = cods.filter((c) => !ja.has(c));
      if (novos.length) add('cod', rotNuc(k), `${ja.size} conhecido(s)`, `+${novos.length} código(s)`, true, { tipo: 'cod', chave: k, codigos: novos },
        'serve para avisar quando alguém for criar um cadastro com código repetido');
    }
    // sugestões
    let nSug = 0;
    const sugNovas = {}, extNovas = {};
    for (const [gr, vals] of Object.entries(prop.sugestoes)) {
      const ja = new Set((atual.sugestoes || {})[gr] || []);
      const nv = vals.filter((v) => !ja.has(v));
      if (nv.length) { sugNovas[gr] = nv; nSug += nv.length; }
    }
    for (const [q, vals] of Object.entries(prop.extensiveis)) {
      const ja = new Set(((atual.extensiveis || {})[q] || []).map(C.chaveOpcao));
      const nv = vals.filter((v) => !ja.has(C.chaveOpcao(v)));
      if (nv.length) { extNovas[q] = nv; nSug += nv.length; }
    }
    if (nSug) {
      const ex = [].concat(...Object.values(sugNovas), ...Object.values(extNovas)).slice(0, 6).join(', ');
      add('sug', `${nSug} valor(es) novo(s) para o autocompletar`, '', ex + (nSug > 6 ? '…' : ''), true, { tipo: 'sug', sugestoes: sugNovas, extensiveis: extNovas },
        'ruas, bairros, profissões, órgãos e opções novas das listas abertas');
    }

    // cadastros: novos, campos vazios, conflitos — e grafia
    const doAparelho = atual.cadastros || [];
    const achar = (mun, cod) => doAparelho.find((c) => c.codigo === cod && c.municipio === mun)
      || doAparelho.find((c) => c.codigo === cod && (!c.municipio || !mun) && C.nuicDoCodigo(c.codigo) === C.nuicDoCodigo(cod));
    const vistos = new Set();
    for (const cad of prop.cadastros) {
      const idCad = `${cad.municipio}|${cad.codigo}`;
      if (vistos.has(idCad)) continue;            // linha repetida na planilha: vale a primeira
      vistos.add(idCad);
      const rotCad = `${cad.codigo}${cad.respostas['3'] ? ' · ' + cad.respostas['3'] : ''}${cad.municipio ? '' : ' · sem município'}`;
      const at = achar(cad.municipio, cad.codigo);
      // grafia das opções: o que chegou diferente do CDRF oficial
      const grafias = [];
      for (const [q, v] of Object.entries(cad.respostas)) {
        const of = C.formaOficial(P, +q, v);
        if (of !== v) grafias.push([q, v, of]);
      }
      if (!at) {
        add('cadnovo', rotCad, '', `${Object.keys(cad.respostas).length} campo(s)`, true, { tipo: 'cad_novo', cad });
        grafias.forEach(([q, v, of]) => add('graf', `${cad.codigo} · ${rotQ(P, q)}`, v, of, true, { tipo: 'graf', municipio: cad.municipio, codigo: cad.codigo, q, de: v, para: of }));
        continue;
      }
      const pjAqui = C.ehPJ(at.respostas), pjLa = C.ehPJ(cad.respostas);
      if (pjAqui && !pjLa) {                       // prefeitura no aparelho, beneficiário de verdade na planilha
        add('cadconf', `${rotCad}`, `prefeitura (${at.respostas['3'] || 'pessoa jurídica'})`, `beneficiário: ${cad.respostas['3'] || '(sem nome)'}`, false,
          { tipo: 'cad_troca', key: at.key, cad }, 'troca o cadastro inteiro da prefeitura pelo beneficiário da planilha');
        continue;
      }
      for (const [q, v] of Object.entries(cad.respostas)) {
        const a = str(at.respostas[q]).trim();
        if (a === v || (v === '***' && vz(a))) continue;
        if (a && a === C.formaOficial(P, +q, v)) continue;   // aqui já está a grafia certa do que veio
        if (C.paraPlanilha(P, +q, a) === C.paraPlanilha(P, +q, v)) continue;   // saem iguais na planilha (regime "Não se aplica" = ***)
        const ehOpcao = ((P.questoes || {})[q] || {}).tipo === 'select';
        if (ehOpcao && !vz(a) && C.chaveOpcao(a) === C.chaveOpcao(v) && C.formaOficial(P, +q, a) === a) continue;
        if (vz(a)) add('cadvazio', `${at.codigo} · ${rotQ(P, q)}`, a, v, true, { tipo: 'cad_campo', key: at.key, q, valor: v });
        else add('cadconf', `${at.codigo} · ${rotQ(P, q)}`, a, v, false, { tipo: 'cad_campo', key: at.key, q, valor: v });
      }
      for (const [n, v] of Object.entries(cad.extras)) {
        const a = str((at.extras || {})[n]).trim();
        if (a === v) continue;
        add(a ? 'cadconf' : 'cadvazio', `${at.codigo} · ${rotCol(P, +n)}`, a, v, !a, { tipo: 'cad_extra', key: at.key, n, valor: v });
      }
      if (cad.idreg && str(at.idreg).trim() !== cad.idreg) {
        add(at.idreg ? 'cadconf' : 'cadvazio', `${at.codigo} · (1) Id.Registro do CDRF`, at.idreg || '', cad.idreg, !at.idreg, { tipo: 'cad_idreg', key: at.key, valor: cad.idreg },
          'é o número que o CDRF usa para sobrescrever o registro certo');
      }
      grafias.forEach(([q, v, of]) => {
        if (str(at.respostas[q]).trim() === of) return;
        add('graf', `${at.codigo} · ${rotQ(P, q)}`, v, of, true, { tipo: 'graf', key: at.key, q, de: v, para: of });
      });
    }
    return itens;
  }

  return { GRUPOS, tabelaDoBanco, cadastroDaLinha, aprender, comparar, montarFaixas, normRua, ehPlaceholder, colunaDaQuestao };
});
