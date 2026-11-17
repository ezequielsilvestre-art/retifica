/* app.js — a tela do CDRF Campo. A lógica de verdade está em cdrf-core.js
 * (portada do programa Python). Tudo fica guardado no próprio aparelho:
 * não há nenhuma chamada de rede.
 *
 * O app NÃO depende de pacote do PC. As regras do CDRF vêm embutidas
 * (regras-cdrf.js); municípios, núcleos, ruas, valores padrão, códigos e
 * sugestões ele APRENDE recebendo uma planilha pronta (Receber planilha),
 * sempre mostrando antes o que vai mudar para você decidir. */
(function () {
  'use strict';
  const C = window.CDRF;
  const A = window.CDRF_APRENDER;
  const VERSAO_APP = '2.0';
  const PFX = 'cdrf.c|';

  // ───────── estado e armazenamento local ─────────
  const extraVazio = () => ({ municipios: {}, nucleos: {}, ruas: {}, padrao: {}, existentes: {}, sugestoes: {}, extensiveis: {} });
  const S = { P: null, base: null, extra: extraVazio(), cad: {}, sel: '', exp: {}, undo: null,
    tela: 'inicio', g: null, aberto: null, busca: '', fquadra: 'todas', fmostrar: 'todos', marcados: new Set() };

  const ler = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  function gravar(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) { aviso('⚠ Não consegui salvar no aparelho — libere espaço e exporte a planilha já.'); return false; }
  }
  function apagarChave(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } }

  // ───────── dados efetivos: regras do CDRF + o que o aparelho aprendeu e cadastrou ─────────
  const colideFaixa = (a, b) => {
    const ai = parseInt(a.lote_ini, 10), af = parseInt(a.lote_fim, 10);
    const bi = parseInt(b.lote_ini, 10), bf = parseInt(b.lote_fim, 10);
    if ([ai, af, bi, bf].some(Number.isNaN)) return false;
    return ai <= bf && bi <= af;
  };
  const porLoteIni = (a, b) => (parseInt(a.lote_ini, 10) || 0) - (parseInt(b.lote_ini, 10) || 0);
  function mesclarExtras() {
    const R = S.base;
    if (!R) { S.P = null; return; }
    const P = Object.assign({}, R);
    const mun = { municipios: {}, nucleos: {} }, nuc = {};
    for (const [m, i] of Object.entries(S.extra.municipios || {})) mun.municipios[m] = Object.assign({}, i);
    const registrar = (k, nome) => {
      const [m, n] = C.partesDaChave(k);
      if (!m || !n) return;
      nuc[k] = { municipio: m, nuic: n, nome: nome || '' };
      mun.nucleos[k] = { nome: nome || '', municipio: m };
      if (!mun.municipios[m]) mun.municipios[m] = {};
    };
    for (const [k, i] of Object.entries(S.extra.nucleos || {})) registrar(C.chaveNucleo(i.municipio || C.partesDaChave(k)[0], i.nuic || C.partesDaChave(k)[1]), i.nome);
    const mapa = { nucleos: {} };
    const voc = { rua: new Set(), bairro: new Set(), cep: new Set(), cidade: new Set(), estado: new Set() };
    for (const [k, quadras] of Object.entries(S.extra.ruas || {})) {
      const q2 = {};
      for (const [qd, f] of Object.entries(quadras || {})) {
        if (!f || !f.length) continue;
        q2[qd] = f.slice().sort(porLoteIni);
        f.forEach((fx) => Object.keys(voc).forEach((c) => { const v = C.str(fx[c]).trim(); if (v && v !== '***') voc[c].add(v); }));
      }
      mapa.nucleos[k] = { quadras: q2 };
      if (!nuc[k]) registrar(k, '');                // núcleo que só tem ruas também aparece
    }
    // autocompletar: o que o mapa de ruas tem (como o PC) + o que veio nas planilhas
    const catalogo = {};
    for (const [grupo, campo] of Object.entries(R.cat_mapa || {})) {
      let l = Array.from(voc[campo] || []);
      if (grupo === 'municipio') l = l.concat(Object.keys(mun.municipios));
      if (grupo === 'estado') l = l.concat(R.estados || []);
      catalogo[grupo] = Array.from(new Set(l)).sort();
    }
    catalogo.nacionalidade = ((R.catalogo_fixo || {}).nacionalidade || []).slice();
    Object.assign(P, { municipios: mun, nucleos: nuc, mapa, catalogo, padrao: {},
      sugestoes_grupo: S.extra.sugestoes || {}, sugestoes_extensiveis: S.extra.extensiveis || {}, existentes: S.extra.existentes || {} });
    S.P = P;
  }
  const gravarExtra = () => gravar('cdrf.extra', JSON.stringify(S.extra));

  // Versões até a 1.1 guardavam um "pacote do PC" no aparelho. Os dados dele (núcleos, ruas,
  // valores padrão…) passam a ser dados do próprio aparelho, sem perder nada; o pacote some.
  function migrarPacoteAntigo() {
    let p = null;
    try { p = JSON.parse(ler('cdrf.pacote') || 'null'); } catch (e) { p = null; }
    if (!p || !p.questoes) return;
    const x = S.extra;
    for (const [m, i] of Object.entries((p.municipios || {}).municipios || {})) {
      const at = (x.municipios[m] = x.municipios[m] || {});
      for (const [c, v] of Object.entries(i || {})) if (v && !at[c]) at[c] = v;
    }
    for (const [k, i] of Object.entries(p.nucleos || {})) {
      const at = x.nucleos[k];
      if (!at) x.nucleos[k] = { municipio: i.municipio, nuic: i.nuic, nome: i.nome || '' };
      else if (!at.nome && i.nome) at.nome = i.nome;
    }
    for (const [k, info] of Object.entries((p.mapa || {}).nucleos || {})) {
      const alvo = (x.ruas[k] = x.ruas[k] || {});
      for (const [qd, faixas] of Object.entries(info.quadras || {})) {
        const minhas = (alvo[qd] = alvo[qd] || []);
        faixas.forEach((fx) => { if (!minhas.some((a) => colideFaixa(a, fx))) minhas.push(Object.assign({}, fx)); });
      }
    }
    const global = {};
    Object.entries(p.padrao || {}).forEach(([c, v]) => { if (v && c !== 'municipio' && c !== 'nucleo_nome') global[c] = v; });
    if (Object.keys(global).length) {
      Object.keys(x.nucleos).forEach((k) => { x.padrao[k] = Object.assign({}, global, x.padrao[k] || {}); });
    }
    for (const [k, cods] of Object.entries(p.existentes || {})) x.existentes[k] = Array.from(new Set((x.existentes[k] || []).concat(cods)));
    for (const [g, vals] of Object.entries(p.sugestoes_grupo || {})) x.sugestoes[g] = Array.from(new Set((x.sugestoes[g] || []).concat(vals))).sort();
    for (const [q, vals] of Object.entries(p.sugestoes_extensiveis || {})) x.extensiveis[q] = Array.from(new Set((x.extensiveis[q] || []).concat(vals))).sort();
    if (gravarExtra()) apagarChave('cdrf.pacote');
  }

  function carregar() {
    S.base = window.CDRF_REGRAS && window.CDRF_REGRAS.questoes ? window.CDRF_REGRAS : null;
    try {
      const x = JSON.parse(ler('cdrf.extra') || 'null');
      if (x) S.extra = Object.assign(extraVazio(), x);
    } catch (e) { /* ok */ }
    migrarPacoteAntigo();
    mesclarExtras();
    S.sel = ler('cdrf.sel') || '';
    try { S.exp = JSON.parse(ler('cdrf.exp') || '{}') || {}; } catch (e) { S.exp = {}; }
    try { S.undo = JSON.parse(ler('cdrf.undo') || 'null'); } catch (e) { S.undo = null; }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PFX)) { const c = JSON.parse(localStorage.getItem(k)); if (c && c.codigo) S.cad[k.slice(PFX.length)] = c; }
      }
    } catch (e) { /* segue com o que deu */ }
    if (S.sel && !nucleoAtual()) S.sel = '';
  }

  const chaveCad = (mun, cod) => `${mun}|${cod}`;
  const salvarCad = (key) => { const c = S.cad[key]; c.atualizado = new Date().toISOString(); return gravar(PFX + key, JSON.stringify(c)); };

  // ───────── núcleos ─────────
  function listaNucleos() {
    if (!S.P) return [];
    return Object.entries(S.P.nucleos || {}).map(([chave, n]) => Object.assign({ chave }, n))
      .sort((a, b) => (a.municipio + a.nuic).localeCompare(b.municipio + b.nuic, 'pt-BR'));
  }
  const nucleoAtual = () => listaNucleos().find((n) => n.chave === S.sel) || null;
  function nucleoDeduzido() {                       // sem local escolhido, o NUIC dos cadastros resolve
    const nuics = new Set(listaTodos().map(nuicDe).filter(Boolean));
    if (nuics.size !== 1) return null;
    const cands = listaNucleos().filter((x) => x.nuic === Array.from(nuics)[0]);
    return cands.length === 1 ? cands[0] : null;
  }
  const nucleoTrab = () => nucleoAtual() || nucleoDeduzido();
  const rotuloNucleo = (n) => `${n.municipio || '?'} · NUIC ${n.nuic}${n.nome ? ' · ' + n.nome : ' · (sem nome)'}`;

  // ───────── pequenos utilitários de tela ─────────
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  function mostrar(...nos) { document.getElementById('app').replaceChildren(...nos); window.scrollTo(0, 0); }

  let tAviso = null;
  function aviso(msg) {
    const a = document.getElementById('aviso'); a.textContent = msg; a.hidden = false;
    clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, 3500);
  }
  function caixa(titulo, msg, botoes) {           // botoes: [{t, v, classe}]
    return new Promise((res) => {
      const m = document.getElementById('modal');
      const fim = (v) => { m.hidden = true; m.replaceChildren(); res(v); };
      m.replaceChildren(h('div', { class: 'caixa' }, h('h2', {}, titulo), h('p', {}, msg),
        h('div', { class: 'linha' }, botoes.map((b) => h('button', { class: b.classe || '', onclick: () => fim(b.v) }, b.t)))));
      m.hidden = false;
    });
  }
  const avisarCaixa = (t, m) => caixa(t, m, [{ t: 'OK', v: true, classe: 'primario' }]);
  const confirmar = (t, m, sim = 'Sim', nao = 'Não') => caixa(t, m, [{ t: nao, v: false }, { t: sim, v: true, classe: 'primario' }]);
  const fmtData = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso || ''; } };

  // ───────── peças de tela ─────────
  // Os ícones são os MESMOS do programa do PC (icones.py), gerados em alta resolução.
  const ico = (nome) => h('img', { class: 'ico', src: 'icones/' + nome + '.png', alt: '' });
  function topoApp(sub, extra) {
    return h('div', { class: 'topo' }, h('h1', {}, 'RETIfica'),
      h('div', { class: 'sub' }, sub || ('Projeto Topos · cadastro de beneficiários · v' + VERSAO_APP)), extra || '');
  }
  function botaoVoltar(fn, rot) { return h('button', { class: 'mini voltar', onclick: fn || (() => telaInicio()) }, rot || '◂ Início'); }
  const nuicDe = (c) => C.nuicDoCodigo(c.codigo);
  const listaTodos = () => Object.entries(S.cad).map(([key, c]) => Object.assign({ key }, c)).sort((a, b) => (a.codigo < b.codigo ? -1 : 1));
  // cadastros que entram na planilha do local atual: os do núcleo + os "sem local" de mesmo NUIC
  const doLocal = (n) => listaTodos().filter((c) => (n ? (nuicDe(c) === n.nuic && (!c.municipio || c.municipio === n.municipio)) : !c.municipio));
  const semLocalDoNucleo = (n) => (n ? listaTodos().filter((c) => !c.municipio && nuicDe(c) === n.nuic) : []);
  const chaveRuas = (c) => C.chaveNucleo(c.municipio || (nucleoAtual() || {}).municipio || '', nuicDe(c));
  function tile(icone, texto, sub, fn, extra) {
    extra = extra || {};
    return h('button', Object.assign({ class: 'tile' + (extra.primario ? ' primario' : '') + (extra.largo ? ' largo' : ''), onclick: fn },
      extra.desligado ? { disabled: true } : {}), ico(icone), h('span', { class: 'rot' }, texto), sub ? h('small', {}, sub) : '');
  }

  // ───────── estado de cada cadastro (cores da lista do programa) ─────────
  function estadoCad(c) {
    const flux = C.fluxoDeCampos(S.P, c.respostas);
    const feitos = flux.filter((q) => !C.vazio(c.respostas, q)).length;
    const div = calcularReaplicacao([c]).conf.length > 0;
    return { feitos, total: flux.length, completo: feitos === flux.length, diverge: div,
      cor: div ? 'diverge' : (feitos === flux.length ? 'ok' : 'falta') };
  }

  // ───────── tela inicial: as ações do editor do PC, em botões ─────────
  function telaInicio() {
    S.tela = 'inicio'; S.g = null; S.aberto = null;
    const P = S.P, n = nucleoAtual();
    const topo = topoApp();
    const corpo = h('div', { class: 'corpo' });
    if (!P) {
      corpo.append(h('div', { class: 'card alerta' }, h('h2', {}, 'Faltam as regras do CDRF'),
        h('p', { class: 'suave' }, 'O arquivo regras-cdrf.js não foi carregado. Instale o app de novo.')));
      mostrar(topo, corpo); return;
    }
    const todos = listaTodos(), noLocal = doLocal(n), ult = S.exp[S.sel || '_'], sem = semLocalDoNucleo(n);
    if (!listaNucleos().length && !todos.length) {
      corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Comece recebendo uma planilha'),
        h('p', { class: 'suave', style: 'margin-top:0' }, 'Este aparelho ainda não conhece nenhum município, núcleo ou rua. Receba uma planilha pronta (no formato do banco do CDRF, feita no PC ou em outro celular): o app aprende com ela os municípios, os núcleos, as ruas de cada quadra, os valores padrão e os cadastros — e mostra tudo antes, para você decidir. Também dá para começar do zero, escolhendo o Local de trabalho.'),
        h('button', { class: 'primario', onclick: escolherPlanilha }, ico('importar'), 'Receber planilha')));
    }
    corpo.append(h('div', { class: 'card local' + (n ? '' : ' alerta'), onclick: () => telaLocal() },
      h('div', { class: 'suave' }, 'Local de trabalho'),
      h('div', { class: 'localtxt' }, n ? rotuloNucleo(n) : 'Não definido — toque para escolher o município e o núcleo')));
    if (sem.length) corpo.append(h('div', { class: 'card alerta' }, h('div', {}, `${sem.length} cadastro(s) sem local, do núcleo ${n.nuic}.`),
      h('button', { class: 'mini', style: 'margin-top:8px', onclick: usarLocalNosSemLocal }, `Usar ${n.municipio} nesses cadastros`)));
    corpo.append(h('div', { class: 'grade-tiles' },
      tile('novo', 'Novo cadastro', 'Ficha de um beneficiário, passo a passo', () => telaNovo(), { primario: true, largo: true }),
      tile('cadastros', 'Cadastros', todos.length ? `${todos.length} neste aparelho` : 'Nenhum ainda', () => telaCadastros()),
      tile('importar', 'Receber planilha', 'Aprende núcleos, ruas e cadastros', escolherPlanilha),
      tile('config', 'Aplicar configuração', 'Completa o que falta nos cadastros', () => telaAplicar(), { desligado: !todos.length }),
      tile('ruas', 'Ruas e quadras', 'Faixas de lote do núcleo', () => telaRuas()),
      tile('prefeitura', 'Lotes da prefeitura', 'Lotes que faltam na quadra', () => telaPrefeitura()),
      tile('padron_tudo', 'Padronizar todos', 'Acentos, CPF, CEP, telefone', () => padronizarTodos(), { desligado: !todos.length }),
      tile('exportar', 'Exportar planilha', ult ? `Última: ${fmtData(ult.em)}` : (noLocal.length ? `${noLocal.length} cadastro(s)` : 'Nada para exportar'), exportar, { desligado: !noLocal.length })));
    if (temUndo()) {
      corpo.append(h('button', { class: 'mini', onclick: desfazerAplicacao }, ico('desfazer'),
        `Desfazer: ${S.undo.tipo} (${S.undo.n} ${S.undo.receber ? 'mudança(s)' : 'campo(s)'})`));
    }
    const dias = ult ? Math.floor((Date.now() - new Date(ult.em).getTime()) / 86400000) : null;
    if (noLocal.length && (dias === null || dias >= 3)) {
      corpo.append(h('div', { class: 'card alerta' },
        dias === null ? 'Você ainda não exportou nenhuma planilha. Exporte ao fim do dia: é a cópia do trabalho fora do aparelho.'
          : `Última exportação há ${dias} dias. Exporte de novo para não deixar o trabalho só neste aparelho.`));
    }
    corpo.append(h('div', { class: 'suave' }, 'A planilha exportada pode ser recebida no programa do PC ou em outro celular (Receber planilha). Tudo fica só neste aparelho; não usa internet.'));
    mostrar(topo, corpo);
  }

  // ───────── local de trabalho: município e núcleo (como o diálogo do programa) ─────────
  function municipiosConhecidos() {
    const s = new Set(Object.keys((S.P.municipios || {}).municipios || {}));
    Object.values(S.P.nucleos || {}).forEach((x) => { if (x.municipio) s.add(x.municipio); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  function telaLocal(msg) {
    S.tela = 'local';
    const atual = nucleoAtual();
    const v = { mun: atual ? atual.municipio : '', novoMun: '', estado: 'Pernambuco', nuc: atual ? atual.chave : '', nuic: '', nome: '' };
    const caixaCampos = h('div', {});
    const desenhar = () => {
      const muns = municipiosConhecidos();
      const selMun = h('select', { onchange: (e) => { v.mun = e.target.value; v.nuc = ''; desenhar(); } },
        h('option', { value: '' }, 'Escolha o município…'),
        muns.map((m) => h('option', { value: m, selected: m === v.mun }, m)),
        h('option', { value: '__novo__', selected: v.mun === '__novo__' }, 'Outro município (digitar)…'));
      const partes = [h('label', {}, 'Município'), selMun];
      if (v.mun === '__novo__') {
        partes.push(h('label', {}, 'Nome do município'), h('input', { type: 'text', value: v.novoMun, autocomplete: 'off', oninput: (e) => { v.novoMun = e.target.value; } }),
          h('label', {}, 'Estado'), h('input', { type: 'text', value: v.estado, autocomplete: 'off', oninput: (e) => { v.estado = e.target.value; } }));
      }
      if (v.mun) {
        const nucs = v.mun === '__novo__' ? [] : listaNucleos().filter((x) => x.municipio === v.mun);
        partes.push(h('label', {}, 'Núcleo'), h('select', { onchange: (e) => { v.nuc = e.target.value; desenhar(); } },
          h('option', { value: '' }, 'Escolha o núcleo…'),
          nucs.map((x) => h('option', { value: x.chave, selected: x.chave === v.nuc }, `NUIC ${x.nuic}${x.nome ? ' · ' + x.nome : ' · (sem nome)'}`)),
          h('option', { value: '__novo__', selected: v.nuc === '__novo__' }, 'Novo núcleo (digitar)…')));
        if (v.nuc === '__novo__' || v.mun === '__novo__') {
          if (v.mun === '__novo__' && v.nuc !== '__novo__') v.nuc = '__novo__';
          partes.push(h('div', { class: 'linha' }, h('div', {}, h('label', {}, 'NUIC (2 dígitos)'),
            h('input', { type: 'text', inputmode: 'numeric', maxlength: 2, value: v.nuic, oninput: (e) => { v.nuic = C.soDigitos(e.target.value).slice(0, 2); e.target.value = v.nuic; } })),
            h('div', { style: 'flex:2' }, h('label', {}, 'Nome do núcleo (pode ficar em branco)'),
              h('input', { type: 'text', value: v.nome, autocomplete: 'off', oninput: (e) => { v.nome = e.target.value; } }))));
        }
      }
      caixaCampos.replaceChildren(...partes);
    };
    desenhar();
    const corpo = h('div', { class: 'corpo' },
      msg ? h('div', { class: 'card alerta' }, msg) : '',
      h('div', { class: 'card' },
        h('p', { class: 'suave', style: 'margin-top:0' }, 'Escolha uma vez onde a equipe está cadastrando. Daí em diante cada cadastro novo só pede o código. O mesmo NUIC pode existir em mais de um município, por isso o município vem primeiro.'),
        caixaCampos),
      h('div', { class: 'linha' }, h('button', { onclick: () => telaInicio() }, 'Cancelar'),
        h('button', { class: 'primario', onclick: () => salvarLocal(v) }, 'Usar este local')),
      h('button', { class: 'mini', onclick: () => { S.sel = ''; gravar('cdrf.sel', ''); aviso('Sem local de trabalho.'); telaInicio(); } }, 'Trabalhar sem local (só com o código)'));
    if (atual) {
      const vn = { nome: atual.nome || '' };
      corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Núcleo de agora'),
        h('p', { class: 'suave', style: 'margin-top:0' }, rotuloNucleo(atual)),
        h('div', {}, h('label', {}, 'Nome do núcleo (vai na coluna 73 da planilha)'),
          h('input', { type: 'text', value: vn.nome, autocomplete: 'off', oninput: (e) => { vn.nome = e.target.value; } }),
          h('button', { class: 'mini', style: 'margin-top:8px', onclick: () => renomearNucleo(atual.chave, vn.nome) }, 'Salvar o nome')),
        h('button', { class: 'mini', style: 'margin-top:10px', onclick: () => telaPadrao() }, ico('config'), 'Valores padrão deste núcleo')));
    }
    corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Aprender de uma planilha'),
      h('p', { class: 'suave', style: 'margin-top:0' }, 'Recebeu uma planilha pronta do PC ou de outro celular? O app aprende com ela municípios, núcleos, ruas, valores padrão e cadastros — e mostra antes o que muda, para você decidir.'),
      h('button', { class: 'mini', onclick: escolherPlanilha }, ico('importar'), 'Receber planilha')));
    mostrar(topoApp('Local de trabalho'), corpo);
    try { history.pushState({ t: 'local' }, ''); } catch (e) { /* ok */ }
  }
  async function salvarLocal(v) {
    let mun = v.mun === '__novo__' ? v.novoMun.trim() : v.mun;
    if (!mun) { await avisarCaixa('Local de trabalho', 'Escolha ou digite o município.'); return; }
    if (v.mun === '__novo__') {                                    // evita duplicar por acento/maiúscula
      const ja = municipiosConhecidos().find((m) => C.semAcento(m).toLowerCase() === C.semAcento(mun).toLowerCase());
      if (ja) mun = ja; else S.extra.municipios[mun] = { estado: v.estado.trim() };
    }
    let chave = v.nuc;
    if (!chave) { await avisarCaixa('Local de trabalho', 'Escolha o núcleo.'); return; }
    if (chave === '__novo__') {
      if (v.nuic.length !== 2) { await avisarCaixa('Novo núcleo', 'Informe o NUIC: são os 2 primeiros dígitos do código do cadastro.'); return; }
      chave = C.chaveNucleo(mun, v.nuic);
      // o nome pode ficar em branco agora e ser preenchido depois, aqui mesmo
      if (!(S.P.nucleos || {})[chave]) S.extra.nucleos[chave] = { municipio: mun, nuic: v.nuic, nome: v.nome.trim() };
    }
    gravarExtra(); mesclarExtras();
    S.sel = chave; gravar('cdrf.sel', S.sel);
    aviso('Local de trabalho definido.');
    oferecerAplicar([chave], 'O local de trabalho mudou. Estes campos dos cadastros já feitos neste núcleo mudariam:', () => telaInicio());
  }
  function renomearNucleo(chave, nome) {
    const [m, n] = C.partesDaChave(chave);
    const e = (S.extra.nucleos[chave] = S.extra.nucleos[chave] || { municipio: m, nuic: n, nome: '' });
    e.nome = String(nome || '').trim();
    gravarExtra(); mesclarExtras();
    aviso(e.nome ? 'Nome do núcleo salvo.' : 'Núcleo sem nome.');
    telaLocal();
  }

  // Mudou a configuração (local, rua, valor padrão, planilha recebida)? Os cadastros já feitos daquele
  // núcleo NÃO mudam sozinhos: se algo mudaria neles, mostra a lista para você decidir.
  const cadsDoNucleo = (chave) => {
    const [m, n] = C.partesDaChave(chave);
    return listaTodos().filter((c) => nuicDe(c) === n && (!c.municipio || c.municipio === m));
  };
  function oferecerAplicar(chaves, motivo, depois) {
    const vistos = new Set(), lista = [];
    (chaves || []).forEach((k) => cadsDoNucleo(k).forEach((c) => { if (!vistos.has(c.key)) { vistos.add(c.key); lista.push(c); } }));
    const { mud, conf } = calcularReaplicacao(lista);
    if (!mud.length && !conf.length) { if (depois) depois(); return false; }
    telaAplicar(lista, 'Aplicar nos cadastros já feitos', { motivo, voltar: depois || (() => telaInicio()), depois: depois || (() => telaInicio()) });
    return true;
  }

  // ───────── valores padrão do loteamento, por núcleo (menu 4 do programa) ─────────
  const padraoDaChave = (chave) => Object.assign({}, S.P.padrao || {}, (S.extra.padrao || {})[chave] || {});
  const padraoDoCad = (c) => padraoDaChave(C.chaveNucleo(c.municipio || '', nuicDe(c)));
  function telaPadrao() {
    const n = nucleoTrab();
    if (!n) { telaLocal('Escolha o núcleo para editar os valores padrão.'); return; }
    S.tela = 'padrao';
    const atual = padraoDaChave(n.chave), v = Object.assign({}, atual);
    const corpo = h('div', { class: 'corpo' }, botaoVoltar(() => telaLocal(), '◂ Local'),
      h('p', { class: 'suave', style: 'margin:0' }, 'O que é igual no núcleo inteiro. Vale para os próximos cadastros; nos já feitos, o app mostra o que mudaria antes de aplicar. Pode vir de uma planilha recebida.'));
    const card = h('div', { class: 'card' });
    (S.P.q_padrao || []).forEach(([chave, q]) => {
      const def = S.P.questoes[String(q)] || {};
      const opc = C.opcoesDoCampo(S.P, q, {});
      card.append(h('label', {}, `${def.rotulo || chave} (Q${q})`),
        opc.length
          ? h('select', { onchange: (e) => { v[chave] = e.target.value; } },
            h('option', { value: '' }, '(não definido)'),
            opc.map((op) => h('option', { value: op, selected: op === (v[chave] || '') }, op)))
          : h('input', { type: 'text', value: v[chave] || '', autocomplete: 'off', oninput: (e) => { v[chave] = e.target.value; } }));
    });
    corpo.append(card, h('button', { class: 'primario', onclick: () => salvarPadrao(n.chave, v) }, 'Salvar valores padrão'));
    mostrar(topoApp('Valores padrão · ' + rotuloNucleo(n)), corpo);
    try { history.pushState({ t: 'padrao' }, ''); } catch (e) { /* ok */ }
  }
  function salvarPadrao(chave, v) {
    const so = {};
    Object.entries(v).forEach(([k, val]) => { if (String(val || '').trim()) so[k] = String(val).trim(); });
    S.extra.padrao = S.extra.padrao || {};
    if (Object.keys(so).length) S.extra.padrao[chave] = so; else delete S.extra.padrao[chave];
    gravarExtra();
    aviso('Valores padrão salvos.');
    oferecerAplicar([chave], 'Os valores padrão do núcleo mudaram. Nos cadastros já feitos, estes campos mudariam:', () => telaLocal());
  }

  async function usarLocalNosSemLocal() {
    const n = nucleoAtual(), sem = semLocalDoNucleo(n);
    if (!n || !sem.length) return;
    if (!(await confirmar('Cadastros sem local', `Usar ${n.municipio} · núcleo ${n.nuic} em ${sem.length} cadastro(s) que estavam sem local?\n\nDepois use “Aplicar configuração” para completar o endereço do imóvel.`, 'Usar', 'Cancelar'))) return;
    let n2 = 0;
    sem.forEach((c) => { if (atribuirMunicipio(c.key, n.municipio)) n2++; });
    aviso(`${n2} cadastro(s) atualizado(s).`); telaInicio();
  }
  function atribuirMunicipio(key, mun) {
    const c = S.cad[key]; if (!c) return false;
    const nk = chaveCad(mun, c.codigo);
    if (S.cad[nk]) return false;
    delete S.cad[key]; apagarChave(PFX + key);
    c.municipio = mun; S.cad[nk] = c; salvarCad(nk);
    return true;
  }
  // ───────── lista de cadastros (a coluna esquerda do editor do PC) ─────────
  const F = { TODOS: 'todos', PEND: 'com pendência', OK: 'completos', DIV: 'com divergência', PREF: 'prefeitura', PESSOA: 'beneficiário' };
  function filtrarLista() {
    const busca = C.semAcento(S.busca).trim();
    return listaTodos().filter((c) => {
      if (S.fquadra !== 'todas' && C.quadraVisivel(C.quadraLoteDoCodigo(c.codigo)[0] || '') !== S.fquadra) return false;
      if (busca) {
        const alvo = C.semAcento(c.codigo + ' ' + (c.respostas['3'] || ''));
        if (!alvo.includes(busca)) return false;
      }
      if (S.fmostrar === F.TODOS) return true;
      if (S.fmostrar === F.PREF) return C.ehPJ(c.respostas);
      if (S.fmostrar === F.PESSOA) return !C.ehPJ(c.respostas);
      const e = estadoCad(c);
      if (S.fmostrar === F.OK) return e.completo && !e.diverge;
      if (S.fmostrar === F.PEND) return !e.completo;
      if (S.fmostrar === F.DIV) return e.diverge;
      return true;
    });
  }
  function quadrasDosCadastros() {
    const s = new Set();
    listaTodos().forEach((c) => { const q = C.quadraLoteDoCodigo(c.codigo)[0]; if (q) s.add(C.quadraVisivel(q)); });
    return Array.from(s).sort();
  }
  function telaCadastros() {
    S.tela = 'cadastros'; S.aberto = null;
    const n = nucleoAtual(), lista = filtrarLista(), todos = listaTodos();
    const busca = h('input', { type: 'text', class: 'busca', value: S.busca, placeholder: 'Buscar código ou nome',
      autocomplete: 'off', oninput: (e) => { S.busca = e.target.value; redesenharLista(); } });
    const chip = (txt, ativo, fn) => h('button', { class: 'fchip' + (ativo ? ' on' : ''), onclick: fn }, txt);
    const filtros = h('div', { class: 'chips' },
      [F.TODOS, F.PEND, F.OK, F.DIV, F.PREF, F.PESSOA].map((f) => chip(f, S.fmostrar === f, () => { S.fmostrar = f; telaCadastros(); })),
      quadrasDosCadastros().map((q) => chip('quadra ' + q, S.fquadra === q, () => { S.fquadra = S.fquadra === q ? 'todas' : q; telaCadastros(); })));
    const caixaLista = h('div', { class: 'lista' });
    const contador = h('div', { class: 'suave' });
    const rodape = h('div', { class: 'rodape acoes', hidden: true });
    function redesenharLista() {
      const itens = filtrarLista();
      caixaLista.replaceChildren(...(itens.length ? itens.map(linhaCad)
        : [h('p', { class: 'suave' }, todos.length ? 'Nenhum cadastro com esse filtro.' : 'Nenhum ainda. Na tela inicial, toque em “Novo cadastro”.')]));
      contador.textContent = `${itens.length} de ${todos.length} cadastro(s)` + (S.marcados.size ? ` · ${S.marcados.size} marcado(s)` : '');
      rodape.hidden = !S.marcados.size;
    }
    rodape.append(
      h('button', { class: 'mini', onclick: () => telaAplicarVarios() }, ico('lote'), 'Aplicar'),
      h('button', { class: 'mini', onclick: () => padronizarMarcados() }, ico('padron_tudo'), 'Padronizar'),
      h('button', { class: 'mini perigo', onclick: () => excluirMarcados() }, ico('excluir'), 'Excluir'));
    redesenharLista();
    const corpo = h('div', { class: 'corpo' }, h('div', { class: 'linha' }, botaoVoltar(), h('div', { style: 'flex:3' }, busca)),
      filtros, contador, caixaLista);
    if (todos.length) corpo.append(h('button', { class: 'linhabtn', onclick: () => { const t = filtrarLista(); const marcarTudo = S.marcados.size < t.length; S.marcados = new Set(marcarTudo ? t.map((c) => c.key) : []); telaCadastros(); } },
      S.marcados.size ? 'Desmarcar todos' : 'Marcar todos'));
    mostrar(topoApp(n ? rotuloNucleo(n) : 'Sem local de trabalho'), corpo, rodape);
    try { history.pushState({ t: 'cadastros' }, ''); } catch (e) { /* ok */ }
  }
  function linhaCad(c) {
    const e = estadoCad(c);
    const cx = h('input', { type: 'checkbox', checked: S.marcados.has(c.key), onclick: (ev) => ev.stopPropagation(),
      onchange: (ev) => { if (ev.target.checked) S.marcados.add(c.key); else S.marcados.delete(c.key); telaCadastros(); } });
    return h('div', { class: 'cad ' + e.cor },
      cx,
      h('div', { class: 'info', onclick: () => telaCadastro(c.key) },
        h('div', { class: 'cod' }, c.codigo, ' ',
          h('span', { class: 'chip ' + e.cor }, e.completo ? (e.diverge ? 'diverge' : 'completo') : `${e.feitos}/${e.total}`),
          c.municipio ? '' : h('span', { class: 'chip atencao' }, 'sem local'),
          C.ehPJ(c.respostas) ? h('span', { class: 'chip' }, 'prefeitura') : ''),
        h('div', { class: 'nome suave' }, c.respostas['3'] || '(sem nome)')),
      h('button', { class: 'mini', onclick: () => telaCadastro(c.key) }, '›'));
  }
  function primeiroVazio(c) {                       // a primeira questão sem resposta (0 = desde o começo)
    const q = C.fluxoDeCampos(S.P, c.respostas).find((x) => C.vazio(c.respostas, x));
    return q === undefined ? 0 : q;
  }
  async function excluir(c) {
    if (!(await confirmar('Excluir cadastro', `Apagar o cadastro ${c.codigo} deste aparelho?\n\nIsso não pode ser desfeito.`, 'Excluir', 'Cancelar'))) return;
    delete S.cad[c.key]; apagarChave(PFX + c.key); S.marcados.delete(c.key); telaCadastros();
  }
  const marcados = () => listaTodos().filter((c) => S.marcados.has(c.key));
  async function excluirMarcados() {
    const alvo = marcados(); if (!alvo.length) return;
    if (!(await confirmar('Excluir', `Excluir ${alvo.length} cadastro(s) deste aparelho?\n\n${alvo.map((c) => c.codigo).join(', ')}\n\nIsso não pode ser desfeito.`, 'Excluir', 'Cancelar'))) return;
    alvo.forEach((c) => { delete S.cad[c.key]; apagarChave(PFX + c.key); });
    S.marcados = new Set(); aviso(`${alvo.length} cadastro(s) excluído(s).`); telaCadastros();
  }

  // ───────── padronizar (botão do programa) ─────────
  function padronizarLista(lista) {
    const desfazer = [];
    let n = 0;
    lista.forEach((c) => {
      const antes = JSON.parse(JSON.stringify(c.respostas));
      const k = C.padronizarRespostas(S.P, c.respostas);
      if (k) { n += k; desfazer.push({ key: c.key, respostas: antes }); salvarCad(c.key); }
    });
    if (desfazer.length) { S.undo = { em: new Date().toISOString(), tipo: 'padronizar', cads: desfazer, n }; gravar('cdrf.undo', JSON.stringify(S.undo)); }
    return n;
  }
  function padronizarTodos() {
    const n = padronizarLista(listaTodos());
    aviso(n ? `${n} campo(s) padronizado(s).` : 'Nada a padronizar.');
    telaInicio();
  }
  function padronizarMarcados() {
    const alvo = marcados(); if (!alvo.length) return;
    const n = padronizarLista(alvo);
    aviso(n ? `${n} campo(s) padronizado(s) em ${alvo.length} cadastro(s).` : 'Nada a padronizar.');
    telaCadastros();
  }

  // ───────── cadastro aberto: os campos em cartões ─────────
  function telaCadastro(key) {
    const c = S.cad[key];
    if (!c) { telaCadastros(); return; }
    S.tela = 'cadastro'; S.aberto = key;
    const e = estadoCad(c), flux = C.fluxoDeCampos(S.P, c.respostas);
    const divs = {};
    calcularReaplicacao([Object.assign({ key }, c)]).conf.forEach((x) => { divs[x.q] = x.novo; });
    const faltam = flux.filter((q) => C.vazio(c.respostas, q));
    const ordem = listaTodos(), idx = ordem.findIndex((x) => x.key === key);

    const guia = h('div', { class: 'guia' },
      h('div', { class: 'gtxt' }, faltam.length || Object.keys(divs).length
        ? `${faltam.length} campo(s) a preencher${Object.keys(divs).length ? ` · ${Object.keys(divs).length} diferente(s) do mapa` : ''}`
        : 'Sem pendências. Cadastro completo!'),
      faltam.length ? h('button', { class: 'bpend', onclick: () => abrirGuiado(key, faltam[0], 'cadastro') }, ico('pendencia'), 'Próxima pendência') : '');

    // sem rua no mapa para este lote: atalho para cadastrar a faixa da quadra (o "Ruas da quadra" do programa)
    const [quadra, lote] = C.quadraLoteDoCodigo(c.codigo);
    const semRua = C.vazio(c.respostas, 52) && quadra;
    const atalhoRua = semRua ? h('div', { class: 'card alerta' },
      h('div', {}, `A quadra ${C.quadraVisivel(quadra)} não tem rua cadastrada para o lote ${String(lote).padStart(2, '0')}.`),
      h('button', { class: 'mini', style: 'margin-top:8px', onclick: () => {
        const n2 = nucleoTrab();
        if (!n2) { telaLocal('Escolha o núcleo para cadastrar a rua.'); return; }
        telaFaixa(n2.chave, quadra, null, { lote_ini: String(lote), lote_fim: String(lote) });
      } }, ico('ruas'), 'Cadastrar a rua desta quadra')) : '';

    const cartoes = h('div', { class: 'cartoes' });
    flux.forEach((q) => {
      const def = S.P.questoes[String(q)] || {};
      const v = String(c.respostas[String(q)] || '').trim();
      const origem = (c.origens || {})[String(q)] || '';
      const cor = divs[q] ? 'diverge' : (v ? '' : 'falta');
      cartoes.append(h('div', { class: 'campo ' + cor, onclick: () => abrirGuiado(key, q, 'cadastro') },
        h('div', { class: 'qrot' }, `Q${q} · ${def.rotulo || ''}`),
        h('div', { class: 'qval' + (v ? '' : ' vazio') }, v || '(vazio)'),
        divs[q] ? h('div', { class: 'qobs div' }, `o mapa diz: ${divs[q]}`) : (origem ? h('div', { class: 'qobs' }, 'veio de: ' + origem) : '')));
    });

    const corpo = h('div', { class: 'corpo' },
      h('div', { class: 'linha' }, botaoVoltar(() => telaCadastros(), '◂ Cadastros'),
        h('button', { class: 'mini', disabled: idx <= 0, onclick: () => telaCadastro(ordem[idx - 1].key) }, '‹ Anterior'),
        h('button', { class: 'mini', disabled: idx < 0 || idx >= ordem.length - 1, onclick: () => telaCadastro(ordem[idx + 1].key) }, 'Próximo ›')),
      guia,
      atalhoRua,
      h('div', { class: 'linha' },
        h('button', { class: 'mini', onclick: () => copiarAnterior(key) }, ico('copiar'), 'Copiar anterior'),
        h('button', { class: 'mini', onclick: () => { const n = padronizarLista([Object.assign({ key }, c)]); aviso(n ? `${n} campo(s) padronizado(s).` : 'Nada a padronizar.'); telaCadastro(key); } }, ico('padron_este'), 'Padronizar'),
        h('button', { class: 'mini', onclick: () => telaAplicar([Object.assign({ key }, c)], 'Aplicar configuração · ' + c.codigo) }, ico('config'), 'Configuração')),
      cartoes,
      h('div', { class: 'linha' },
        h('button', { class: 'mini perigo', onclick: () => excluir(Object.assign({ key }, c)) }, ico('excluir'), 'Excluir'),
        h('button', { class: 'primario', onclick: () => abrirGuiado(key, faltam.length ? faltam[0] : 0, 'cadastro') }, 'Preencher guiado')));
    mostrar(topoApp(`${c.codigo} · ${c.respostas['3'] || '(sem nome)'}`, h('div', { class: 'sub' },
      e.completo ? (e.diverge ? 'completo, com divergência' : 'completo') : `${e.feitos} de ${e.total} campos`)), corpo);
    try { history.pushState({ t: 'cadastro' }, ''); } catch (e2) { /* ok */ }
  }

  // MENU._copiar_anterior — copia do cadastro anterior só os campos vazios
  const CAMPOS_COPIAVEIS = [5, 19, 30, 35, 36, 37, 38, 39, 40, 41, 43, 44, 48, 49, 50, 51, 60, 61, 62, 63, 64, 65];
  async function copiarAnterior(key) {
    const ordem = listaTodos(), idx = ordem.findIndex((x) => x.key === key);
    if (idx <= 0) { await avisarCaixa('Copiar anterior', 'Este é o primeiro cadastro — não há anterior.'); return; }
    const ant = ordem[idx - 1], c = S.cad[key], copiados = [];
    CAMPOS_COPIAVEIS.forEach((q) => {
      const v = String((ant.respostas || {})[String(q)] || '').trim();
      if (v && C.vazio(c.respostas, q)) { c.respostas[String(q)] = v; (c.origens || (c.origens = {}))[String(q)] = `copiado de ${ant.codigo}`; copiados.push('Q' + q); }
    });
    if (!copiados.length) { await avisarCaixa('Copiar anterior', 'Nada a copiar — os campos já estão preenchidos ou o anterior está vazio.'); return; }
    salvarCad(key);
    aviso(`${copiados.length} campo(s) copiado(s) de ${ant.codigo}.`);
    telaCadastro(key);
  }

  // ───────── desfazer, comum às ações em massa ─────────
  const instantaneo = (lista) => lista.map((c) => ({ key: c.key, respostas: JSON.parse(JSON.stringify(c.respostas)) }));
  function registrarUndo(tipo, antes, n) {
    S.undo = { em: new Date().toISOString(), tipo, cads: antes, n };
    gravar('cdrf.undo', JSON.stringify(S.undo));
  }
  const temUndo = () => !!(S.undo && ((S.undo.cads || []).length || S.undo.receber));
  async function desfazerAplicacao() {
    if (!temUndo()) return;
    const R = S.undo.receber;
    const msg = R
      ? `Desfazer o recebimento da planilha?\n\n${S.undo.n} mudança(s)${R.novos.length ? `, ${R.novos.length} cadastro(s) novo(s) (serão apagados)` : ''}.\n\nNúcleos, ruas, valores padrão e cadastros voltam como estavam antes.`
      : `Desfazer a última ação?\n\n${S.undo.tipo} (${S.undo.n} campo(s))\n\nOs cadastros voltam como estavam antes dela.`;
    if (!(await confirmar('Desfazer', msg, 'Desfazer', 'Cancelar'))) return;
    if (R) {
      S.extra = Object.assign(extraVazio(), R.extra); gravarExtra(); mesclarExtras();
      R.novos.forEach((k) => { delete S.cad[k]; apagarChave(PFX + k); });
      Object.entries(R.cads || {}).forEach(([k, c]) => { S.cad[k] = c; salvarCad(k); });
      if (S.sel && !nucleoAtual()) { S.sel = ''; gravar('cdrf.sel', ''); }
    }
    (S.undo.cads || []).forEach((x) => { const c = S.cad[x.key]; if (!c) return; c.respostas = x.respostas; salvarCad(x.key); });
    const t = S.undo.tipo;
    S.undo = null; apagarChave('cdrf.undo');
    aviso(`Ação desfeita: ${t}.`); telaInicio();
  }

  // ───────── aplicar a vários (MENU "Aplicar à quadra") ─────────
  function telaAplicarVarios() {
    const alvo = marcados();
    if (!alvo.length) { avisarCaixa('Aplicar a vários', 'Marque ☑ os cadastros na lista primeiro.'); return; }
    S.tela = 'lote';
    const campos = C.fluxoDeCampos(S.P, {});
    const v = { q: '', valor: '', soVazios: true };
    const caixaValor = h('div', {});
    const desenhaValor = () => {
      const q = parseInt(v.q, 10);
      if (!q) { caixaValor.replaceChildren(); return; }
      const def = S.P.questoes[String(q)] || {};
      if (def.tipo === 'select') {
        caixaValor.replaceChildren(h('label', {}, 'Valor'),
          h('select', { onchange: (e) => { v.valor = e.target.value; } },
            h('option', { value: '' }, 'Escolha…'),
            C.opcoesDoCampo(S.P, q, {}).map((op) => h('option', { value: op, selected: op === v.valor }, op))));
      } else {
        const tp = C.tipoDeMascara(S.P, q, {});
        caixaValor.replaceChildren(h('label', {}, 'Valor'),
          h('input', { type: 'text', value: v.valor, autocomplete: 'off', oninput: (e) => {
            v.valor = tp ? C.mascaraValor(tp, e.target.value) : e.target.value; e.target.value = v.valor; } }));
      }
    };
    const corpo = h('div', { class: 'corpo' }, botaoVoltar(() => telaCadastros(), '◂ Cadastros'),
      h('div', { class: 'card' }, h('h2', {}, `Aplicar a ${alvo.length} cadastro(s)`),
        h('p', { class: 'suave', style: 'margin-top:0' }, alvo.map((c) => c.codigo).join(', ')),
        h('label', {}, 'Campo'),
        h('select', { onchange: (e) => { v.q = e.target.value; v.valor = ''; desenhaValor(); } },
          h('option', { value: '' }, 'Escolha o campo…'),
          campos.map((q) => h('option', { value: q }, `Q${q} · ${(S.P.questoes[String(q)] || {}).rotulo || ''}`))),
        caixaValor,
        h('label', { class: 'checklinha' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { v.soVazios = e.target.checked; } }),
          h('span', {}, 'Só preencher os campos vazios (não sobrescreve)'))),
      h('button', { class: 'primario', onclick: () => aplicarVarios(alvo, v) }, 'Aplicar'));
    mostrar(topoApp('Aplicar a vários'), corpo);
    try { history.pushState({ t: 'lote' }, ''); } catch (e) { /* ok */ }
  }
  async function aplicarVarios(alvo, v) {
    const q = parseInt(v.q, 10);
    if (!q) { await avisarCaixa('Aplicar a vários', 'Escolha o campo.'); return; }
    const valor = String(v.valor || '').trim();
    if (!valor) { await avisarCaixa('Aplicar a vários', 'Escolha ou digite o valor.'); return; }
    const erro = C.validarQuestao(S.P, q, valor);
    if (erro) { await avisarCaixa('Valor inválido', erro); return; }
    const cheios = alvo.filter((c) => !C.vazio(c.respostas, q));
    if (!v.soVazios && cheios.length &&
        !(await confirmar('Sobrescrever', `${cheios.length} cadastro(s) já têm valor nesse campo e serão sobrescritos.\n\nContinuar?`, 'Sobrescrever', 'Cancelar'))) return;
    const antes = instantaneo(alvo);
    let n = 0;
    alvo.forEach((c) => {
      if (v.soVazios && !C.vazio(c.respostas, q)) return;
      c.respostas[String(q)] = C.formatarTexto(S.P, q, valor, c.respostas);
      (c.origens || (c.origens = {}))[String(q)] = 'aplicado a vários';
      salvarCad(c.key); n++;
    });
    if (n) registrarUndo(`aplicar Q${q}`, antes, n);
    aviso(n ? `${n} cadastro(s) atualizado(s).` : 'Nenhum campo vazio para preencher.');
    telaCadastros();
  }

  // ───────── ruas e quadras (tela 3 do programa, aqui no celular) ─────────
  const ruasDoAparelho = (chave) => (S.extra.ruas[chave] = S.extra.ruas[chave] || {});
  function telaRuas() {
    const n = nucleoTrab();
    if (!n) { telaLocal('Escolha o município e o núcleo para cadastrar as ruas.'); return; }
    S.tela = 'ruas';
    const quadras = C.quadrasDoNucleo(S.P.mapa, n.chave);
    const corpo = h('div', { class: 'corpo' }, botaoVoltar(),
      h('p', { class: 'suave', style: 'margin:0' }, 'Cada faixa diz qual rua atende um intervalo de lotes da quadra. É daqui que o endereço do imóvel é preenchido. As faixas vêm das planilhas recebidas ou são cadastradas aqui, e vão junto na planilha exportada.'),
      h('button', { class: 'primario', onclick: () => telaFaixa(n.chave, '', null) }, '＋  Nova faixa de lotes'));
    const nomes = Object.keys(quadras).sort();
    if (!nomes.length) corpo.append(h('div', { class: 'card alerta' }, 'Nenhuma rua cadastrada neste núcleo ainda.'));
    nomes.forEach((qd) => {
      const faixas = quadras[qd] || [];
      const bloco = h('div', { class: 'card' }, h('h2', {}, 'Quadra ' + C.quadraVisivel(qd)));
      faixas.forEach((fx) => {
        bloco.append(h('div', { class: 'faixa', onclick: () => telaFaixa(n.chave, qd, fx) },
          h('div', { class: 'fl' }, `Lotes ${String(fx.lote_ini).padStart(2, '0')}–${String(fx.lote_fim).padStart(2, '0')}`),
          h('div', {}, fx.rua || '(sem rua)'),
          h('div', { class: 'suave' }, [fx.bairro, fx.cep, fx.cidade].filter(Boolean).join(' · '))));
      });
      const cob = C.resumoCobertura(faixas);
      bloco.append(h('div', { class: 'suave', style: 'margin-top:6px' }, 'Com rua: ' + cob.texto
        + (cob.buracos.length ? ` · sem rua: ${cob.buracos.map((x) => String(x).padStart(2, '0')).join(', ')}` : '')));
      const probs = C.problemasDasFaixas(faixas);
      if (probs.length) bloco.append(h('ul', { class: 'faltou' }, probs.map((p) => h('li', {}, p))));
      corpo.append(bloco);
    });
    mostrar(topoApp('Ruas e quadras · ' + rotuloNucleo(n)), corpo);
    try { history.pushState({ t: 'ruas' }, ''); } catch (e) { /* ok */ }
  }
  function telaFaixa(chave, quadra, fx, sug) {
    S.tela = 'faixa';
    const n = nucleoTrab(), mun = (S.P.municipios.municipios || {})[n.municipio] || {};
    const v = Object.assign({ quadra: quadra ? C.quadraVisivel(quadra) : '', lote_ini: '', lote_fim: '', rua: '', bairro: '',
      cep: '', cidade: n.municipio, estado: mun.estado || '' }, sug || {}, fx ? Object.assign({ quadra: C.quadraVisivel(quadra) }, fx) : {});
    const campo = (rot, k, extra) => h('div', {}, h('label', {}, rot),
      h('input', Object.assign({ type: 'text', value: v[k], autocomplete: 'off', oninput: (e) => {
        v[k] = k === 'cep' ? C.mascaraValor('cep', e.target.value) : e.target.value; e.target.value = v[k]; } }, extra || {})));
    const doApp = fx && (ruasDoAparelho(chave)[quadra] || []).includes(fx);
    const corpo = h('div', { class: 'corpo' }, botaoVoltar(() => telaRuas(), '◂ Ruas'),
      h('div', { class: 'card' },
        h('div', { class: 'linha' }, campo('Quadra', 'quadra', { autocapitalize: 'characters' }),
          campo('Lote inicial', 'lote_ini', { inputmode: 'numeric' }), campo('Lote final', 'lote_fim', { inputmode: 'numeric' })),
        campo('Rua'.concat(''), 'rua'), campo('Bairro', 'bairro'),
        h('div', { class: 'linha' }, campo('CEP', 'cep', { inputmode: 'numeric' }), campo('Cidade', 'cidade')),
        campo('Estado', 'estado')),
      h('div', { class: 'linha' },
        doApp ? h('button', { class: 'mini perigo', onclick: () => excluirFaixa(chave, quadra, fx) }, 'Excluir faixa') : '',
        h('button', { class: 'primario', onclick: () => salvarFaixa(chave, quadra, fx, v) }, 'Salvar faixa')));
    mostrar(topoApp(fx ? 'Editar faixa de lotes' : 'Nova faixa de lotes'), corpo);
    try { history.pushState({ t: 'faixa' }, ''); } catch (e) { /* ok */ }
  }
  async function salvarFaixa(chave, quadraAntiga, fx, v) {
    const qd = C.normalizarQuadra(v.quadra);
    const ini = parseInt(v.lote_ini, 10), fim = parseInt(v.lote_fim, 10);
    if (!qd) { await avisarCaixa('Faixa', 'Informe a quadra (a letra basta: F).'); return; }
    if (Number.isNaN(ini) || Number.isNaN(fim)) { await avisarCaixa('Faixa', 'Informe o lote inicial e o lote final.'); return; }
    if (ini > fim) { await avisarCaixa('Faixa', 'O lote inicial é maior que o final.'); return; }
    if (!String(v.rua || '').trim()) { await avisarCaixa('Faixa', 'Informe a rua.'); return; }
    const nova = { lote_ini: ini, lote_fim: fim, rua: C.escritaPadrao(S.P, String(v.rua).trim()), bairro: String(v.bairro || '').trim(),
      cep: String(v.cep || '').trim(), cidade: String(v.cidade || '').trim(), estado: String(v.estado || '').trim() };
    const minhas = ruasDoAparelho(chave);
    if (fx) {                                     // editar: tira a antiga do aparelho, se era dele
      const lista = minhas[quadraAntiga] || [];
      const i = lista.indexOf(fx);
      if (i >= 0) lista.splice(i, 1);
    }
    (minhas[qd] = minhas[qd] || []).push(nova);
    gravarExtra(); mesclarExtras();
    aviso('Faixa salva.');
    oferecerAplicar([chave], `A rua da quadra ${C.quadraVisivel(qd)} mudou. Nos cadastros já feitos, estes campos mudariam:`, () => telaRuas());
  }
  async function excluirFaixa(chave, quadra, fx) {
    if (!(await confirmar('Excluir faixa', `Apagar a faixa de lotes ${fx.lote_ini}–${fx.lote_fim} (${fx.rua})?`, 'Excluir', 'Cancelar'))) return;
    const lista = ruasDoAparelho(chave)[quadra] || [];
    const i = lista.indexOf(fx);
    if (i >= 0) lista.splice(i, 1);
    gravarExtra(); mesclarExtras(); aviso('Faixa excluída.'); telaRuas();
  }

  // ───────── lotes da prefeitura (MENU.DialogoPrefeitura + criar_prefeitura) ─────────
  function telaPrefeitura() {
    const n = nucleoTrab();
    if (!n) { telaLocal('Escolha o município e o núcleo para abrir os lotes da prefeitura.'); return; }
    S.tela = 'prefeitura';
    const quadras = new Set(Object.keys(C.quadrasDoNucleo(S.P.mapa, n.chave)));
    doLocal(n).forEach((c) => { const q = C.quadraLoteDoCodigo(c.codigo)[0]; if (q) quadras.add(q); });
    const v = { quadra: '', total: '' };
    const saida = h('div', {});
    const mostrarFaltantes = () => {
      const faltam = faltantesDaQuadra(n, v.quadra, v.total);
      if (!v.quadra) { saida.replaceChildren(h('p', { class: 'suave' }, 'Escolha a quadra.')); return; }
      if (!faltam.lista.length) {
        saida.replaceChildren(h('p', { class: 'suave' }, `Quadra ${C.quadraVisivel(v.quadra)}: todos os ${faltam.total} lotes já têm cadastro.`));
        return;
      }
      saida.replaceChildren(
        h('p', {}, `Quadra ${C.quadraVisivel(v.quadra)}: ${faltam.total} lotes. Faltam ${faltam.lista.length}: `
          + faltam.lista.map((x) => String(x.lote).padStart(2, '0')).join(', ')),
        h('button', { class: 'primario', onclick: () => criarPrefeitura(n, faltam.lista) }, 'Criar cadastros da prefeitura'));
    };
    const corpo = h('div', { class: 'corpo' }, botaoVoltar(),
      h('div', { class: 'card' },
        h('p', { class: 'suave', style: 'margin-top:0' }, 'Abre no nome da prefeitura os lotes da quadra que ainda não têm cadastro, com o endereço do imóvel vindo do mapa de ruas.'),
        h('label', {}, 'Quadra'),
        h('select', { onchange: (e) => { v.quadra = e.target.value; mostrarFaltantes(); } },
          h('option', { value: '' }, 'Escolha…'),
          Array.from(quadras).sort().map((q) => h('option', { value: q }, 'Quadra ' + C.quadraVisivel(q)))),
        h('label', { style: 'margin-top:10px' }, 'Total de lotes da quadra (vazio = pelo mapa de ruas)'),
        h('input', { type: 'text', inputmode: 'numeric', value: '', oninput: (e) => { v.total = e.target.value; mostrarFaltantes(); } })),
      saida);
    mostrar(topoApp('Lotes da prefeitura'), corpo);
    try { history.pushState({ t: 'prefeitura' }, ''); } catch (e) { /* ok */ }
  }
  function faltantesDaQuadra(n, quadra, totalTxt) {
    if (!quadra) return { total: 0, lista: [] };
    const existentes = new Set();
    doLocal(n).forEach((c) => {
      const [q, lote] = C.quadraLoteDoCodigo(c.codigo);
      if (q === quadra && lote !== null) existentes.add(lote);
    });
    let total = parseInt(totalTxt, 10);
    if (Number.isNaN(total) || total <= 0) {
      const nums = [];
      (C.faixasDaQuadra(S.P.mapa, quadra, n.chave) || []).forEach((fx) => { nums.push(parseInt(fx.lote_ini, 10), parseInt(fx.lote_fim, 10)); });
      const val = nums.filter((x) => !Number.isNaN(x));
      total = val.length ? Math.max(...val) : (existentes.size ? Math.max(...existentes) : 0);
    }
    const lista = [];
    for (let lote = 1; lote <= total; lote++) {
      if (existentes.has(lote)) continue;
      lista.push({ lote, codigo: C.montarCodigo(n.nuic, quadra, String(lote).padStart(2, '0'), '00') });
    }
    return { total, lista };
  }
  async function criarPrefeitura(n, faltam) {
    if (!(await confirmar('Lotes da prefeitura', `Criar ${faltam.length} cadastro(s) da prefeitura?`, 'Criar', 'Cancelar'))) return;
    const mun = (S.P.municipios.municipios || {})[n.municipio] || {};
    let criados = 0;
    faltam.forEach((x) => {
      const key = chaveCad(n.municipio, x.codigo);
      if (S.cad[key]) return;
      const r = C.cascataAplicar(S.P, x.codigo, { municipio: n.municipio, padrao: padraoDaChave(n.chave) });
      const resp = r.respostas;
      Object.assign(resp, { 3: mun.prefeitura || ('Prefeitura Municipal de ' + n.municipio), 8: mun.cnpj || '', 14: 'pessoa jurídica',
        33: mun.logradouro || '', 34: mun.numero || '', 35: mun.bairro || '', 36: n.municipio, 37: mun.estado || '', 38: mun.cep || '' });
      if (!C.vazio(resp, 52)) Object.assign(resp, { 53: '***', 54: '***', 55: '***' });
      S.cad[key] = { municipio: n.municipio, codigo: x.codigo, respostas: resp, origens: r.origens, criado: new Date().toISOString(), prefeitura: true };
      if (salvarCad(key)) criados++; else delete S.cad[key];
    });
    aviso(`${criados} cadastro(s) criado(s).`);
    telaCadastros();
  }

  // ───────── Aplicar configuração (DialogoReaplicar do programa) ─────────
  // Campo vazio (ou "***") vem marcado; campo já preenchido que diverge do mapa vem DESmarcado.
  const EXPLICA_CONFIG = 'Pega o que está cadastrado em Ruas e quadras, no município e núcleo e nos valores padrão, e completa os cadastros já feitos — só os campos vazios. O que já está preenchido e ficou diferente aparece em separado, para você decidir.';
  function calcularReaplicacao(lista) {
    const mud = [], conf = [];
    for (const c of lista) {
      const r = C.cascataAplicar(S.P, c.codigo, { municipio: c.municipio || null, respostas: {}, padrao: padraoDoCad(c) });
      for (const [q, v0] of Object.entries(r.respostas)) {
        const novo = String(v0 || '').trim(); if (!novo) continue;
        const atual = String((c.respostas || {})[q] || '').trim();
        if (atual === novo) continue;
        const item = { key: c.key, cod: c.codigo, q, atual, novo, origem: (r.origens || {})[q] || '' };
        if (!atual || atual === '***') mud.push(item); else conf.push(item);
      }
    }
    const ord = (a, b) => (a.cod < b.cod ? -1 : a.cod > b.cod ? 1 : (+a.q) - (+b.q));
    return { mud: mud.sort(ord), conf: conf.sort(ord) };
  }
  // opc = {motivo, voltar, depois}: usado quando uma mudança de configuração pede para revisar os cadastros
  function telaAplicar(lista, titulo, opc) {
    S.tela = 'aplicar';
    opc = opc || {};
    const alvo = lista || (S.marcados.size ? marcados() : listaTodos());
    const { mud, conf } = calcularReaplicacao(alvo);
    const umCad = titulo && !opc.voltar && alvo.length === 1;
    const voltar = opc.voltar ? botaoVoltar(opc.voltar, '◂ Agora não') : (umCad ? botaoVoltar(() => telaCadastro(alvo[0].key), '◂ Cadastro') : botaoVoltar());
    const depois = opc.depois || (umCad ? () => telaCadastro(alvo[0].key) : () => telaInicio());
    if (!mud.length && !conf.length) {
      mostrar(topoApp(titulo || 'Aplicar configuração'), h('div', { class: 'corpo' }, voltar,
        h('div', { class: 'card' }, h('h2', {}, 'Nada a fazer'),
          h('p', { class: 'suave', style: 'margin:0' }, `Os ${alvo.length} cadastro(s) já estão de acordo com o mapa de ruas, os municípios e os valores padrão.`)),
        h('div', { class: 'card' }, h('h2', {}, 'Para que serve'), h('p', { class: 'suave', style: 'margin:0' }, EXPLICA_CONFIG))));
      try { history.pushState({ t: 'aplicar' }, ''); } catch (e) { /* ok */ }
      return;
    }
    const itens = mud.map((x) => Object.assign({ marcado: true, conf: false }, x)).concat(conf.map((x) => Object.assign({ marcado: false, conf: true }, x)));
    const resumo = h('div', { class: 'suave' });
    const caixa = h('div', { class: 'reap' });
    const atualiza = () => { resumo.textContent = `${itens.filter((i) => i.marcado).length} de ${itens.length} marcado(s). Os que já estavam preenchidos e ficaram diferentes vêm desmarcados.`; };
    itens.forEach((it) => {
      const cb = h('input', { type: 'checkbox', checked: it.marcado, onchange: (e) => { it.marcado = e.target.checked; atualiza(); } });
      caixa.append(h('label', { class: 'reapitem' + (it.conf ? ' conf' : '') }, cb,
        h('div', {}, h('div', {}, h('b', {}, it.cod), ` · Q${it.q} ${(S.P.questoes[it.q] || {}).rotulo || ''}`),
          h('div', { class: 'suave' }, `Está: ${it.atual || '(vazio)'}`),
          h('div', {}, `Passa a ser: ${it.novo}`),
          it.origem ? h('div', { class: 'suave' }, 'vem de: ' + it.origem) : '')));
    });
    atualiza();
    const todos = (m) => { itens.forEach((i) => { i.marcado = m; }); caixa.querySelectorAll('input').forEach((x) => { x.checked = m; }); atualiza(); };
    mostrar(topoApp(titulo || `Aplicar configuração · ${alvo.length} cadastro(s)`), h('div', { class: 'corpo' }, voltar,
      opc.motivo ? h('div', { class: 'card alerta' }, opc.motivo) : '',
      h('div', { class: 'suave' }, EXPLICA_CONFIG), caixa, resumo,
      h('div', { class: 'linha' }, h('button', { onclick: () => todos(true) }, 'Marcar todos'), h('button', { onclick: () => todos(false) }, 'Desmarcar todos')),
      h('button', { class: 'primario', onclick: () => gravarReaplicacao(itens.filter((i) => i.marcado), depois) }, 'Aplicar os marcados')));
    try { history.pushState({ t: 'aplicar' }, ''); } catch (e) { /* ok */ }
  }
  function gravarReaplicacao(sel, depois) {
    if (!sel.length) { aviso('Nada marcado — nenhum cadastro mudou.'); depois(); return; }
    const chaves = Array.from(new Set(sel.map((i) => i.key)));
    const antes = instantaneo(chaves.map((k) => Object.assign({ key: k }, S.cad[k])));
    sel.forEach((i) => {
      const c = S.cad[i.key]; if (!c) return;
      c.respostas[i.q] = i.novo; (c.origens || (c.origens = {}))[i.q] = i.origem || 'Aplicar configuração';
    });
    chaves.forEach((k) => salvarCad(k));
    registrarUndo('aplicar configuração', antes, sel.length);
    aviso(`${sel.length} campo(s) atualizado(s) em ${chaves.length} cadastro(s).`);
    depois();
  }

  // ───────── RECEBER PLANILHA: aprender com uma planilha pronta (formato do banco) ─────────
  function escolherPlanilha() {
    const inp = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true });
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) receberArquivo(f); });
    document.body.append(inp);
    inp.click();
  }
  // a aba "RUAS DO CAMPO" (que este app grava ao exportar) traz faixas inteiras, inclusive de lotes sem cadastro
  function ruasDaAba(aba, prop) {
    const L = aba.linhas || [];
    if (!L.length) return 0;
    const cab = L[0].map((x) => C.semAcento(x));
    const ix = (nome) => cab.indexOf(nome);
    const c = { mun: ix('municipio'), nuic: ix('nuic'), qd: ix('quadra'), ini: ix('lote inicial'), fim: ix('lote final'), rua: ix('rua'),
      bairro: ix('bairro'), cep: ix('cep'), cidade: ix('cidade'), estado: ix('estado') };
    if (c.mun < 0 || c.nuic < 0 || c.qd < 0 || c.ini < 0 || c.fim < 0 || c.rua < 0) return 0;
    let n = 0;
    for (const r of L.slice(1)) {
      const g = (i) => (i < 0 ? '' : C.str(r[i]).trim());
      const mun = g(c.mun), nuic = C.soDigitos(g(c.nuic)).padStart(2, '0'), qd = C.normalizarQuadra(g(c.qd));
      const fx = { lote_ini: parseInt(g(c.ini), 10), lote_fim: parseInt(g(c.fim), 10), rua: g(c.rua), bairro: g(c.bairro), cep: g(c.cep), cidade: g(c.cidade), estado: g(c.estado) };
      if (!mun || !qd || !fx.rua || Number.isNaN(fx.lote_ini) || Number.isNaN(fx.lote_fim)) continue;
      const k = C.chaveNucleo(mun, nuic);
      if (!prop.nucleos[k]) prop.nucleos[k] = { municipio: mun, nuic, nome: '' };
      if (!prop.municipios[mun]) prop.municipios[mun] = fx.estado ? { estado: fx.estado } : {};
      const quadras = (prop.ruas[k] = prop.ruas[k] || {});
      // a faixa explícita vale mais que a deduzida dos cadastros
      quadras[qd] = (quadras[qd] || []).filter((a) => !colideFaixa(a, fx)).concat([fx]).sort(porLoteIni);
      n++;
    }
    return n;
  }
  async function receberArquivo(f) {
    let prop, itens;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const abas = XLSXLer.lerXlsx(bytes);
      const tabela = A.tabelaDoBanco(abas[0].linhas);
      prop = A.aprender(S.P, tabela);
      const abaRuas = abas.find((a) => C.semAcento(a.nome) === 'ruas do campo');
      const nRuasAba = abaRuas ? ruasDaAba(abaRuas, prop) : 0;
      if (nRuasAba) prop.avisos.unshift(`A aba "RUAS DO CAMPO" trouxe ${nRuasAba} faixa(s) de rua cadastradas em outro aparelho.`);
      itens = A.comparar(S.P, prop, {
        municipios: (S.P.municipios || {}).municipios || {}, nucleos: S.P.nucleos || {}, mapa: S.P.mapa,
        padrao: (k) => padraoDaChave(k), existentes: S.extra.existentes || {}, sugestoes: S.extra.sugestoes || {},
        extensiveis: S.extra.extensiveis || {}, cadastros: listaTodos(),
      });
    } catch (e) {
      await avisarCaixa('Receber planilha', 'Não consegui ler esta planilha.\n\n' + (e && e.message ? e.message : e));
      return;
    }
    if (!prop.total) { await avisarCaixa('Receber planilha', 'A planilha não tem nenhum cadastro (coluna "(2) Nº Cadastral" vazia).'); return; }
    if (!itens.length) {
      await avisarCaixa('Receber planilha', `${f.name}\n\n${prop.total} cadastro(s) lido(s). Nada novo: este aparelho já tem tudo o que a planilha traz.`);
      return;
    }
    telaReceber(f.name, prop, itens);
  }

  function telaReceber(nomeArq, prop, itens) {
    S.tela = 'receber';
    const nucs = Object.keys(prop.nucleos).map((k) => k.replace('|', ' · NUIC '));
    const resumo = h('div', { class: 'suave' });
    const atualiza = () => { resumo.textContent = `${itens.filter((i) => i.marcado).length} de ${itens.length} mudança(s) marcada(s).`; };
    const corpo = h('div', { class: 'corpo' }, botaoVoltar(() => telaInicio(), '◂ Cancelar'),
      h('div', { class: 'card' }, h('h2', {}, nomeArq),
        h('p', { class: 'suave', style: 'margin:0' }, `${prop.total} cadastro(s) na planilha${nucs.length ? ' · ' + nucs.join(', ') : ''}.`),
        h('p', { class: 'suave' }, 'Nada muda até você tocar em “Aplicar os marcados”. Vem marcado o que é novo ou completa algo vazio; vem DESMARCADO o que trocaria um valor que já existe neste aparelho.')));
    if (prop.avisos.length) {
      const lista = h('ul', { class: 'faltou' }, prop.avisos.map((a) => h('li', {}, a)));
      const det = h('details', {}, h('summary', {}, `${prop.avisos.length} aviso(s) sobre a planilha`), lista);
      corpo.append(h('div', { class: 'card alerta' }, det));
    }
    for (const [g, rot] of A.GRUPOS) {
      const doGrupo = itens.filter((i) => i.grupo === g);
      if (!doGrupo.length) continue;
      const caixa = h('div', { class: 'reap' });
      const cont = h('span', { class: 'suave' });
      const contar = () => { cont.textContent = ` ${doGrupo.filter((i) => i.marcado).length}/${doGrupo.length}`; atualiza(); };
      const desenhar = (limite) => {
        caixa.replaceChildren(...doGrupo.slice(0, limite).map((it) => {
          const cb = h('input', { type: 'checkbox', checked: it.marcado, onchange: (e) => { it.marcado = e.target.checked; contar(); } });
          return h('label', { class: 'reapitem' + (it.marcado ? '' : ' conf') }, cb,
            h('div', {}, h('div', {}, h('b', {}, it.titulo)),
              it.atual !== '' && it.atual !== undefined ? h('div', { class: 'suave' }, `Está: ${it.atual}`) : (g === 'cadnovo' || /novo/.test(it.titulo) ? '' : h('div', { class: 'suave' }, 'Está: (vazio)')),
              h('div', {}, `${g === 'cadnovo' ? 'Entra com' : 'Passa a ser'}: ${it.novo}`),
              it.nota ? h('div', { class: 'suave' }, it.nota) : ''));
        }));
        if (doGrupo.length > limite) caixa.append(h('button', { class: 'mini', onclick: () => desenhar(doGrupo.length) }, `Mostrar os outros ${doGrupo.length - limite}`));
      };
      desenhar(40);
      const marcarGrupo = (m) => { doGrupo.forEach((i) => { i.marcado = m; }); desenhar(caixa.querySelectorAll('.reapitem').length || 40); contar(); };
      corpo.append(h('div', { class: 'card' },
        h('div', { class: 'linha', style: 'align-items:center' }, h('h2', { style: 'margin:0;flex:3' }, rot, cont),
          h('button', { class: 'mini', onclick: () => marcarGrupo(true) }, 'Todos'), h('button', { class: 'mini', onclick: () => marcarGrupo(false) }, 'Nenhum')),
        caixa));
      contar();
    }
    atualiza();
    corpo.append(resumo, h('button', { class: 'primario', onclick: () => aplicarRecebimento(nomeArq, prop, itens.filter((i) => i.marcado)) }, 'Aplicar os marcados'));
    mostrar(topoApp('Receber planilha'), corpo);
    try { history.pushState({ t: 'receber' }, ''); } catch (e) { /* ok */ }
  }

  async function aplicarRecebimento(nomeArq, prop, sel) {
    if (!sel.length) { aviso('Nada marcado — nada mudou.'); telaInicio(); return; }
    const ordem = A.GRUPOS.map(([g]) => g);
    sel = sel.slice().sort((a, b) => ordem.indexOf(a.grupo) - ordem.indexOf(b.grupo));
    const x = S.extra;
    const antesExtra = JSON.parse(JSON.stringify(x));
    const antesCads = {}, novos = [], tocados = new Set(), nucleosMudados = new Set();
    const guardar = (key) => { if (S.cad[key] && !(key in antesCads)) antesCads[key] = JSON.parse(JSON.stringify(S.cad[key])); };
    const origem = `planilha recebida (${nomeArq})`;
    for (const it of sel) {
      const a = it.acao;
      switch (a.tipo) {
        case 'mun_novo': x.municipios[a.nome] = Object.assign({}, x.municipios[a.nome] || {}, a.dados); break;
        case 'mun_campo': (x.municipios[a.nome] = x.municipios[a.nome] || {})[a.campo] = a.valor; break;
        case 'nuc_novo': x.nucleos[a.chave] = { municipio: a.info.municipio, nuic: a.info.nuic, nome: a.info.nome || '' }; nucleosMudados.add(a.chave); break;
        case 'nuc_nome': {
          const [m, n] = C.partesDaChave(a.chave);
          (x.nucleos[a.chave] = x.nucleos[a.chave] || { municipio: m, nuic: n, nome: '' }).nome = a.nome; nucleosMudados.add(a.chave); break;
        }
        case 'rua_nova': case 'rua_troca': {
          const quadras = (x.ruas[a.chave] = x.ruas[a.chave] || {});
          const limpa = {}; C.CAMPOS_FAIXA.forEach((c) => { limpa[c] = a.faixa[c] === undefined ? '' : a.faixa[c]; });
          let l = quadras[a.quadra] || [];
          if (a.tipo === 'rua_troca') l = l.filter((f) => !colideFaixa(f, limpa));
          else if (l.some((f) => colideFaixa(f, limpa))) break;
          quadras[a.quadra] = l.concat([limpa]).sort(porLoteIni);
          nucleosMudados.add(a.chave); break;
        }
        case 'pad': (x.padrao[a.chave] = x.padrao[a.chave] || {})[a.campo] = a.valor; nucleosMudados.add(a.chave); break;
        case 'cod': x.existentes[a.chave] = Array.from(new Set((x.existentes[a.chave] || []).concat(a.codigos))).sort(); break;
        case 'sug':
          for (const [g, v] of Object.entries(a.sugestoes)) x.sugestoes[g] = Array.from(new Set((x.sugestoes[g] || []).concat(v))).sort();
          for (const [q, v] of Object.entries(a.extensiveis)) x.extensiveis[q] = Array.from(new Set((x.extensiveis[q] || []).concat(v))).sort();
          break;
        case 'cad_novo': {
          const cad = a.cad, key = chaveCad(cad.municipio, cad.codigo);
          if (S.cad[key]) break;
          const origens = {}; Object.keys(cad.respostas).forEach((q) => { origens[q] = origem; });
          S.cad[key] = { municipio: cad.municipio, codigo: cad.codigo, respostas: Object.assign({}, cad.respostas), origens,
            idreg: cad.idreg || '', extras: Object.assign({}, cad.extras), criado: new Date().toISOString(), recebido: nomeArq };
          novos.push(key); tocados.add(key); break;
        }
        case 'cad_troca': {
          guardar(a.key); const c = S.cad[a.key]; if (!c) break;
          const origens = {}; Object.keys(a.cad.respostas).forEach((q) => { origens[q] = origem; });
          Object.assign(c, { respostas: Object.assign({}, a.cad.respostas), origens, idreg: a.cad.idreg || c.idreg || '',
            extras: Object.assign({}, c.extras || {}, a.cad.extras), prefeitura: false });
          tocados.add(a.key); break;
        }
        case 'cad_campo': { guardar(a.key); const c = S.cad[a.key]; if (!c) break; c.respostas[a.q] = a.valor; (c.origens || (c.origens = {}))[a.q] = origem; tocados.add(a.key); break; }
        case 'cad_extra': { guardar(a.key); const c = S.cad[a.key]; if (!c) break; (c.extras = c.extras || {})[a.n] = a.valor; tocados.add(a.key); break; }
        case 'cad_idreg': { guardar(a.key); const c = S.cad[a.key]; if (!c) break; c.idreg = a.valor; tocados.add(a.key); break; }
        case 'graf': {
          const key = a.key || chaveCad(a.municipio, a.codigo);
          if (!a.key) { /* cadastro novo desta mesma planilha */ } else guardar(key);
          const c = S.cad[key]; if (!c) break;
          if (C.str(c.respostas[a.q]).trim() === a.de) { c.respostas[a.q] = a.para; tocados.add(key); }
          break;
        }
        default: break;
      }
    }
    if (!gravarExtra()) { S.extra = antesExtra; return; }
    let falhou = 0;
    tocados.forEach((k) => { if (S.cad[k] && !salvarCad(k)) falhou++; });
    mesclarExtras();
    S.undo = { em: new Date().toISOString(), tipo: 'receber planilha', n: sel.length, cads: [],
      receber: { extra: antesExtra, cads: antesCads, novos } };
    gravar('cdrf.undo', JSON.stringify(S.undo));
    // sem local escolhido e a planilha é de um núcleo só: ele vira o local de trabalho
    const nk = Object.keys(prop.nucleos);
    if (!nucleoAtual() && nk.length === 1 && S.P.nucleos[nk[0]]) { S.sel = nk[0]; gravar('cdrf.sel', S.sel); }
    aviso(`${sel.length} mudança(s) aplicada(s)` + (novos.length ? ` · ${novos.length} cadastro(s) novo(s)` : '') + (falhou ? ` · ⚠ ${falhou} não salvo(s)` : '') + '.');
    // a configuração nova pode completar/mudar campos dos cadastros daqueles núcleos: mostra antes
    oferecerAplicar(Array.from(nucleosMudados), 'A configuração aprendida da planilha mudou ruas, núcleos ou valores padrão. Nos cadastros deste aparelho, estes campos mudariam:', () => telaInicio());
  }
  // ───────── novo cadastro: o código ─────────
  function telaNovo() {
    S.tela = 'novo';
    const n = nucleoAtual();
    const v = { nuic: n ? n.nuic : '', quadra: '', lote: '', edif: '01' };
    const eCod = h('input', { type: 'text', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
    const montar = () => {
      const nu = C.soDigitos(v.nuic).slice(0, 2), q = C.normalizarQuadra(v.quadra), lo = C.soDigitos(v.lote).slice(0, 2), ed = C.soDigitos(v.edif).slice(0, 2);
      if (nu && q && lo) eCod.value = C.montarCodigo(nu, q, lo, ed || '01');
      else if (nu || q || lo || ed) eCod.value = `${nu}${q}${lo}${ed}`;
    };
    const campo = (rot, k, extra) => {
      const i = h('input', Object.assign({ type: 'text', value: v[k], autocomplete: 'off', spellcheck: 'false', oninput: (e) => { v[k] = e.target.value; montar(); } }, extra || {}));
      return h('div', {}, h('label', {}, rot), i);
    };
    montar();
    mostrar(
      h('div', { class: 'topo' }, h('h1', {}, 'Novo cadastro'), h('div', { class: 'sub' }, n ? rotuloNucleo(n) : 'Sem local de trabalho — pode cadastrar só com o código')),
      h('div', { class: 'corpo' },
        h('div', { class: 'card' },
          h('p', { class: 'suave', style: 'margin-top:0' }, 'Ex.: 010F1001 = NUIC 01 · quadra F · lote 10 · edificação 01. Escreva só a letra da quadra (F) e o 0 entra sozinho. Se a cidade passar das 26 letras, escreva a quadra inteira (1D, 2A…).'),
          h('div', { class: 'grade4' }, campo('NUIC', 'nuic', { inputmode: 'numeric' }), campo('Quadra', 'quadra', { autocapitalize: 'characters' }), campo('Lote', 'lote', { inputmode: 'numeric' }), campo('Edif.', 'edif', { inputmode: 'numeric' })),
          h('div', { style: 'margin-top:12px' }, h('label', {}, 'Código cadastral'), eCod)),
        h('div', { class: 'linha' }, h('button', { onclick: () => telaInicio() }, 'Cancelar'),
          h('button', { class: 'primario', onclick: () => criarCadastro(eCod.value.trim().toUpperCase()) }, 'Criar'))));
  }

  async function criarCadastro(cod) {
    const P = S.P, n = nucleoAtual();
    if (!/^(\d+)([A-Za-z]{1,3})(\d+)$/.test(cod) || cod.length < 8) {
      await avisarCaixa('Código', 'Código incompleto.\n\nO formato tem 8 caracteres: NUIC (2 dígitos) + quadra (dígito e letra) + lote (2) + edificação (2).\n\nExemplo: 010F1001.'); return;
    }
    const nuic = C.nuicDoCodigo(cod), municipio = n ? n.municipio : '';
    if (n && nuic !== n.nuic && !(await confirmar('Novo cadastro', `O código ${cod} é do núcleo ${nuic}, diferente do núcleo do local de trabalho (${n.nuic}).\n\nCriar mesmo assim, em ${n.municipio}?`, 'Criar', 'Voltar'))) return;
    const key = chaveCad(municipio, cod);
    const ja = listaTodos().find((c) => c.codigo === cod && (!c.municipio || !municipio || c.municipio === municipio));
    if (ja) { await avisarCaixa('Novo cadastro', `O código ${cod} já existe aqui — vou abri-lo para edição.`); abrirGuiado(ja.key, primeiroVazio(ja)); return; }
    const jaNoPC = municipio && ((P.existentes || {})[C.chaveNucleo(municipio, nuic)] || []).includes(cod);
    if (jaNoPC && !(await confirmar('Código já existe', `O código ${cod} já existe numa planilha recebida deste núcleo (PC ou outro celular).\n\nSe criar aqui, quem receber a sua planilha vai ver cada campo diferente como conflito, para decidir.\n\nCriar mesmo assim?`, 'Criar', 'Voltar'))) return;

    // CASCATA: o cadastro nasce com o que o caminho já respondeu (só o código basta; o resto completa depois)
    const r = C.cascataAplicar(P, cod, { municipio: municipio || null, padrao: padraoDaChave(C.chaveNucleo(municipio, nuic)) });
    S.cad[key] = { municipio, codigo: cod, respostas: r.respostas, origens: r.origens, criado: new Date().toISOString() };
    if (!salvarCad(key)) { delete S.cad[key]; return; }
    telaResumoNovo(key, Object.keys(r.respostas).length, r.faltou);
  }

  const traduzFaltou = (f) => (/^município do núcleo/.test(f)
    ? 'município e núcleo — defina o Local de trabalho e depois use “Aplicar configuração”'
    : /^endereço do imóvel/.test(f)
      ? f.replace(/\s*\(cadastre no menu 3.*$/, '') + ' — digite rua, bairro e CEP no cadastro, ou cadastre a faixa em “Ruas e quadras” (ou receba uma planilha com as ruas)'
      : f);

  function telaResumoNovo(key, n, faltou) {
    S.tela = 'resumo';
    const c = S.cad[key];
    mostrar(
      h('div', { class: 'topo' }, h('h1', {}, `Cadastro ${c.codigo} criado`)),
      h('div', { class: 'corpo' },
        h('div', { class: 'card' }, h('p', { style: 'margin:0' }, `${n} campo(s) já vieram preenchidos pelo código, pelo núcleo, pelo mapa de ruas e pelos valores padrão.`),
          faltou.length ? h('div', { style: 'margin-top:10px' }, h('b', {}, 'Ainda falta:'), h('ul', { class: 'faltou' }, faltou.map((f) => h('li', {}, traduzFaltou(f))))) : null),
        h('p', { class: 'suave' }, 'Quer preencher o resto campo a campo?'),
        h('div', { class: 'linha' }, h('button', { onclick: () => telaCadastros() }, 'Depois'), h('button', { class: 'primario', onclick: () => abrirGuiado(key, 0, 'cadastro') }, 'Preencher agora'))));
  }

  // ───────── cadastro guiado (MENU.JanelaFoco) ─────────
  function abrirGuiado(key, q, volta) {             // q = número da questão onde começar (0 = primeira)
    S.g = { key, q: q || 0, volta: volta || S.tela };
    S.tela = 'guiado';
    try { history.pushState({ t: 'guiado' }, ''); } catch (e) { /* ok */ }
    desenharCampo();
  }

  let tSalva = null;
  function salvarDepois(key) { clearTimeout(tSalva); tSalva = setTimeout(() => salvarCad(key), 350); }

  function desenharCampo() {
    const P = S.P, g = S.g, c = S.cad[g.key], resp = c.respostas, origens = c.origens || (c.origens = {});
    const flux = C.fluxoDeCampos(P, resp);
    // A posição é a QUESTÃO, não o índice: se a resposta mudar o fluxo (ex.: Pessoa Jurídica
    // tira campos), seguimos para a próxima questão e não pulamos nenhuma.
    let i = flux.indexOf(g.q);
    if (i < 0) i = flux.findIndex((x) => x > g.q);
    if (i < 0) return telaTerminou();
    const q = flux[i]; g.q = q;
    const def = P.questoes[String(q)], tipo = def.tipo;
    const ctx = C.dadosDoNucleo(P, c.codigo, c.municipio);
    const partes = [ctx.municipio, ctx.quadra ? `quadra ${ctx.quadra}` : '', ctx.lote !== null ? `lote ${String(ctx.lote).padStart(2, '0')}` : '', resp['56'], resp['52']].filter(Boolean);
    const mascara = C.tipoDeMascara(P, q, resp);
    const eNum = ['cpf', 'cep', 'tel', 'data', 'num'].includes(tipo);

    const dica = h('div', { class: 'dica' });
    const erro = h('div', { class: 'msgerro' });
    const caixaLista = h('div', {});
    const atualizarDica = () => {
      const origem = origens[String(q)];
      if (origem && C.str(resp[String(q)]).trim()) { dica.className = 'dica ok'; dica.textContent = `✓ já preenchido — veio de: ${origem}\nconfira e toque em Avançar, ou digite por cima`; }
      else { dica.className = 'dica'; dica.textContent = C.dicaDoCampo(P, q, resp); }
    };
    const cor = (inp) => {
      const v = inp.value; const k = mascara ? C.corValor(mascara, v) : (v.trim() ? 'ok' : 'neutro');
      inp.classList.toggle('ok', k === 'ok'); inp.classList.toggle('erro', k === 'erro');
    };
    const inp = h('input', { type: 'text', value: C.str(resp[String(q)]), autocomplete: 'off', autocorrect: 'off',
      autocapitalize: tipo === 'text' && q !== 1 ? 'words' : 'none', spellcheck: 'false', inputmode: eNum ? 'numeric' : 'text', enterkeyhint: 'next' });

    let valoresSug = [], opcoes = [];
    if (tipo === 'select' || tipo === 'comodos') opcoes = C.opcoesDoCampo(P, q, Object.values(S.cad));
    else if (tipo === 'text') valoresSug = C.valoresExistentes(P, q, Object.values(S.cad));

    const pintarLista = () => {
      const txt = inp.value;
      if (opcoes.length) {
        const nt = C.semAcento(txt).trim();
        const exata = opcoes.some((o) => C.semAcento(o).trim() === nt);
        const vis = nt && !exata ? opcoes.filter((o) => C.semAcento(o).includes(nt)) : opcoes;
        caixaLista.replaceChildren(h('div', { class: 'opcoes' }, vis.map((o) =>
          h('button', { class: C.semAcento(o).trim() === nt ? 'sel' : '', onclick: () => { inp.value = o; aoDigitar(true); } }, o))));
      } else if (valoresSug.length) {
        const ach = C.sugerir(valoresSug, txt);
        caixaLista.replaceChildren(h('div', { class: 'sugs' }, ach.map((o) => h('button', { onclick: () => { inp.value = o; aoDigitar(true); } }, o))));
      }
    };
    function aoDigitar(daLista) {
      if (mascara) { const m = C.mascaraValor(mascara, inp.value); if (m !== inp.value) inp.value = m; }
      resp[String(q)] = inp.value; salvarDepois(g.key);
      cor(inp); erro.textContent = '';
      if (origens[String(q)] && inp.value.trim() === '') delete origens[String(q)];
      atualizarDica();
      if (daLista && !opcoes.length) caixaLista.replaceChildren(); else pintarLista();
    }
    inp.addEventListener('input', () => aoDigitar(false));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); avancar(); } });

    function avancar() {
      let val = inp.value.trim();
      if (tipo === 'text') { val = C.formatarTexto(P, q, val, resp); inp.value = val; }
      const err = C.validarAvanco(P, q, val, resp);
      if (err) { erro.textContent = '⚠ ' + err; return; }
      resp[String(q)] = val;
      if (val && origens[String(q)]) delete origens[String(q)];
      clearTimeout(tSalva);
      if (!salvarCad(g.key)) return;
      const nx = C.fluxoDeCampos(P, resp).find((x) => x > q); g.q = nx === undefined ? Infinity : nx; desenharCampo();
    }
    function voltar() { const ant = flux.filter((x) => x < q).pop(); if (ant === undefined) return; clearTimeout(tSalva); salvarCad(g.key); g.q = ant; desenharCampo(); }

    cor(inp); atualizarDica(); pintarLista();
    mostrar(
      h('div', { class: 'topo' },
        h('div', { class: 'linha', style: 'align-items:center' }, h('b', {}, `Cadastro ${c.codigo}`), h('div', { class: 'suave', style: 'text-align:right' }, `campo ${i + 1} de ${flux.length}`)),
        h('div', { class: 'barra', style: 'margin-top:8px' }, h('div', { style: `width:${((i + 1) / flux.length) * 100}%` }))),
      h('div', { class: 'corpo' },
        h('div', { class: 'ctx' }, partes.join('  ·  ')),
        h('div', { class: 'rotulo' }, `Q${q} — ${def.rotulo}`),
        inp, caixaLista, dica, erro),
      h('div', { class: 'rodape' },
        h('button', { onclick: voltar, disabled: i === 0 }, '◂ Voltar'),
        h('button', { onclick: () => fecharGuiado(true) }, 'Fechar'),
        h('button', { class: 'primario', onclick: avancar }, 'Avançar ▸')));
    if (!opcoes.length) { inp.focus(); try { inp.select(); } catch (e) { /* ok */ } }
  }

  function telaTerminou() {
    const P = S.P, key = S.g.key, c = S.cad[key];
    // NÃO padroniza sozinho: conta o que o Padronizar mudaria e deixa você decidir
    const teste = JSON.parse(JSON.stringify(c.respostas));
    const npad = C.padronizarRespostas(P, teste);
    const flux = C.fluxoDeCampos(P, c.respostas);
    const n = flux.filter((q) => !C.vazio(c.respostas, q)).length;
    mostrar(h('div', { class: 'topo' }, h('h1', {}, `Cadastro ${c.codigo}`)),
      h('div', { class: 'corpo' },
        h('div', { class: 'card' }, h('h2', {}, 'Ficha terminada'), h('p', { style: 'margin:0' }, `Terminou os ${flux.length} campos da ficha — ${n} preenchido(s).`),
          npad ? h('div', { class: 'card alerta', style: 'margin-top:10px' },
            h('div', {}, `${npad} campo(s) estão fora do padrão (acentos, maiúsculas, grafia do CDRF, CPF, CEP, telefone). Na planilha exportada a grafia das opções já sai certa.`),
            h('button', { class: 'mini', style: 'margin-top:8px', onclick: () => { const k = padronizarLista([Object.assign({ key }, c)]); aviso(`${k} campo(s) padronizado(s).`); telaTerminou(); } }, ico('padron_este'), 'Padronizar agora')) : '',
          h('p', { class: 'suave' }, 'Colunas de cartório, registro e áreas são completadas no programa do PC.')),
        h('div', { class: 'linha' }, h('button', { onclick: () => abrirGuiado(S.g.key, flux[flux.length - 1]) }, '◂ Rever'), h('button', { class: 'primario', onclick: () => voltarDoGuiado() }, 'Concluir'))));
  }
  function voltarDoGuiado() { if (S.g && S.g.volta === 'cadastro' && S.cad[S.g.key]) telaCadastro(S.g.key); else telaCadastros(); }

  async function fecharGuiado(pergunta) {
    if (S.tela !== 'guiado') return true;
    if (pergunta && !(await confirmar('Fechar', 'Parar o preenchimento guiado?\n\nO que você já respondeu está salvo. Dá para continuar depois, tocando no cadastro na lista.', 'Parar', 'Continuar'))) return false;
    clearTimeout(tSalva); if (S.g && S.cad[S.g.key]) salvarCad(S.g.key);
    voltarDoGuiado(); return true;
  }
  window.addEventListener('popstate', async () => {            // botão voltar do Android
    if (S.tela === 'guiado') {
      const parou = await fecharGuiado(true);
      if (!parou) { try { history.pushState({ t: 'guiado' }, ''); } catch (e) { /* ok */ } }
    } else if (S.tela === 'novo' || S.tela === 'resumo' || S.tela === 'cadastro') telaCadastros();
    else if (['cadastros', 'local', 'aplicar', 'ruas', 'prefeitura', 'lote', 'receber'].includes(S.tela)) telaInicio();
    else if (S.tela === 'padrao') telaLocal();
    else if (S.tela === 'faixa') telaRuas();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.g && S.cad[S.g.key]) { clearTimeout(tSalva); salvarCad(S.g.key); } });

  // ───────── exportar planilha ─────────
  // Aba extra com as ruas do aparelho. Os cadastros vão na primeira aba; esta
  // serve para quem receber a planilha (PC ou celular) aprender as ruas — ela
  // traz a faixa inteira, inclusive lotes ainda sem cadastro.
  function abaDeRuas(n) {
    const linhas = [];
    for (const [chave, quadras] of Object.entries(S.extra.ruas || {})) {
      const [mun, nuic] = C.partesDaChave(chave);
      if (n && !(mun === n.municipio && nuic === n.nuic)) continue;
      for (const qd of Object.keys(quadras).sort()) {
        for (const fx of quadras[qd]) {
          linhas.push([mun, nuic, C.quadraVisivel(qd), Number(fx.lote_ini), Number(fx.lote_fim),
            fx.rua || '', fx.bairro || '', fx.cep || '', fx.cidade || '', fx.estado || '']);
        }
      }
    }
    if (!linhas.length) return null;
    return { nome: 'RUAS DO CAMPO', congelar: { linhas: 1, colunas: 0 },
      cabecalho: ['Municipio', 'NUIC', 'Quadra', 'Lote inicial', 'Lote final', 'Rua', 'Bairro', 'CEP', 'Cidade', 'Estado'],
      linhas, larguras: [16, 6, 8, 11, 11, 32, 22, 12, 16, 14] };
  }

  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  async function entregar(nome, bytes) {
    const Cap = window.Capacitor, Pl = Cap && Cap.Plugins;
    if (Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Pl && Pl.Filesystem && Pl.Share) {
      const r = await Pl.Filesystem.writeFile({ path: nome, data: b64(bytes), directory: 'CACHE' });
      await Pl.Share.share({ title: nome, text: 'Planilha CDRF Campo', url: r.uri, dialogTitle: 'Enviar planilha' });
      return;
    }
    // app instalado na tela de início (iPhone): manda pelo compartilhamento do sistema
    try {
      if (navigator.share && typeof File === 'function') {
        const arq = new File([bytes], nome, { type: TIPO_XLSX });
        if (!navigator.canShare || navigator.canShare({ files: [arq] })) {
          await navigator.share({ files: [arq], title: nome });
          return;
        }
      }
    } catch (e) {
      if (e && /abort/i.test(String(e.name || e))) return;      // o usuário fechou o compartilhar
    }
    const blob = new Blob([bytes], { type: TIPO_XLSX });
    const a = h('a', { href: URL.createObjectURL(blob), download: nome }); document.body.append(a); a.click(); a.remove();
  }
  async function exportar() {
    const n = nucleoAtual(), lista = doLocal(n);
    if (!lista.length) return;
    // conferência: o que o PC vai receber
    const incompletos = lista.filter((c) => !estadoCad(c).completo).length;
    const semMun = lista.filter((c) => !c.municipio).length;
    const ruas = (S.extra.ruas[n ? n.chave : ''] || {});
    const nRuas = Object.values(ruas).reduce((t, f) => t + f.length, 0);
    const avisos = [];
    if (semMun) avisos.push(`${semMun} cadastro(s) sem município — defina o Local de trabalho antes, senão o PC não sabe de qual núcleo são.`);
    if (n && !n.nome) avisos.push('O núcleo está sem nome: a coluna 73 vai vazia e o menu 7 do PC não vai detectá-lo sozinho.');
    if (nRuas) avisos.push(`${nRuas} faixa(s) de rua vão numa aba à parte (RUAS DO CAMPO) — quem receber a planilha, no PC ou no celular, aprende as ruas com ela.`);
    if (incompletos) avisos.push(`${incompletos} cadastro(s) ainda têm campos em branco (dá para exportar assim e completar no PC).`);
    const msg = `${lista.length} cadastro(s)${n ? ' de ' + rotuloNucleo(n) : ''}.`
      + (avisos.length ? '\n\n' + avisos.map((a) => '• ' + a).join('\n') : '\n\nTudo certo.');
    if (!(await confirmar('Conferir antes de enviar', msg, 'Exportar', 'Voltar'))) return;
    try {
      const cads = {}; lista.forEach((c) => { cads[c.codigo] = c; });
      const mun = n ? n.municipio : '';
      const abas = C.abasDaPlanilha(S.P, cads, mun);
      const aRuas = abaDeRuas(n);
      if (aRuas) abas.push(aRuas);
      const bytes = XLSXMin.criarXlsx(abas);
      const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
      const san = (t) => C.semAcento(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const quem = n ? `${san(n.municipio)}_${n.nuic}` : 'sem-local';
      const nome = `RETIfica_${quem}_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.xlsx`;
      await entregar(nome, bytes);
      S.exp[S.sel || '_'] = { em: d.toISOString(), n: lista.length }; gravar('cdrf.exp', JSON.stringify(S.exp));
      telaInicio();
    } catch (e) {
      if (e && /cancel/i.test(String(e.message || e))) return;
      avisarCaixa('Exportar', 'Não consegui gerar/enviar a planilha.\n\n' + (e && e.message ? e.message : e));
    }
  }

  carregar();
  try { history.replaceState({ t: 'inicio' }, ''); } catch (e) { /* ok */ }
  telaInicio();
})();
