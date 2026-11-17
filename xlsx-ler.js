/* xlsx-ler.js — lê a PRIMEIRA aba de um .xlsx (e as outras pelo nome), sem
 * rede e sem biblioteca grande: só o fflate (zip). Entende texto
 * compartilhado (sharedStrings), texto em linha, número e booleano — o que o
 * Excel, o LibreOffice, o programa do PC (openpyxl) e este app gravam.
 * Devolve cada aba como uma lista de linhas; cada linha é uma lista de textos.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fflate.umd.js'));
  else root.XLSXLer = factory(root.fflate);
})(typeof self !== 'undefined' ? self : this, function (fflate) {
  'use strict';

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function desesc(s) {
    return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENT[e];
    }).replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  const attr = (tag, nome) => {
    const m = new RegExp('\\s' + nome + '\\s*=\\s*"([^"]*)"').exec(tag);
    return m ? desesc(m[1]) : null;
  };
  // texto de um <si> ou <is>: junta todos os <t> (texto com formatação vem em pedaços <r><t>)
  function textoDe(xml) {
    let out = '';
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    let m;
    // ignora o texto fonético (<rPh>), que o Excel japonês grava junto
    const limpo = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    while ((m = re.exec(limpo))) out += m[1] ? desesc(m[1]) : '';
    return out;
  }
  function colunaDaRef(ref) {             // "AB12" -> 28
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }
  const dec = (u8) => fflate.strFromU8(u8);
  function caminho(base, alvo) {          // resolve "worksheets/sheet1.xml" relativo a "xl/"
    if (alvo.startsWith('/')) return alvo.slice(1);
    const partes = base.split('/').filter(Boolean);
    for (const p of alvo.split('/')) {
      if (p === '..') partes.pop(); else if (p !== '.') partes.push(p);
    }
    return partes.join('/');
  }

  function lerAba(xml, compart) {
    const linhas = [];
    const reLinha = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
    let m, proxima = 1;
    while ((m = reLinha.exec(xml))) {
      const rAttr = m[1] ? attr(' ' + m[1], 'r') : null;
      const rn = rAttr ? parseInt(rAttr, 10) : proxima;
      proxima = rn + 1;
      const cel = [];
      const corpo = m[2] || '';
      const reCel = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let c, prox = 1;
      while ((c = reCel.exec(corpo))) {
        const tag = ' ' + c[1];
        const ref = attr(tag, 'r');
        const col = ref ? colunaDaRef(ref) : prox;
        prox = col + 1;
        const t = attr(tag, 't') || 'n';
        const dentro = c[2] || '';
        let v = '';
        if (t === 'inlineStr') v = textoDe((/<is>([\s\S]*?)<\/is>/.exec(dentro) || [])[1] || '');
        else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(dentro);
          const bruto = vm ? desesc(vm[1]) : '';
          if (t === 's') v = compart[parseInt(bruto, 10)] || '';
          else if (t === 'b') v = bruto === '1' ? 'TRUE' : (bruto === '0' ? 'FALSE' : bruto);
          else if (t === 'str' || t === 'e') v = bruto;
          else v = bruto;                    // número: como o openpyxl entrega (5, 12.5)
        }
        cel[col - 1] = v;
      }
      for (let i = 0; i < cel.length; i++) if (cel[i] === undefined) cel[i] = '';
      linhas[rn - 1] = cel;
    }
    for (let i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = [];
    return linhas;
  }

  // bytes (Uint8Array) -> [{nome, linhas}], na ordem das abas do arquivo
  function lerXlsx(bytes) {
    let zip;
    try { zip = fflate.unzipSync(bytes); } catch (e) { throw new Error('O arquivo não é uma planilha .xlsx (não abriu como zip).'); }
    const wbXml = zip['xl/workbook.xml'] ? dec(zip['xl/workbook.xml']) : null;
    if (!wbXml) throw new Error('O arquivo não é uma planilha .xlsx (falta xl/workbook.xml).');
    const rels = {};
    const relsXml = zip['xl/_rels/workbook.xml.rels'] ? dec(zip['xl/_rels/workbook.xml.rels']) : '';
    const reRel = /<Relationship\b([^>]*)\/?>/g;
    let m;
    while ((m = reRel.exec(relsXml))) rels[attr(' ' + m[1], 'Id')] = attr(' ' + m[1], 'Target');
    const compart = [];
    if (zip['xl/sharedStrings.xml']) {
      const ss = dec(zip['xl/sharedStrings.xml']);
      const reSi = /<si>([\s\S]*?)<\/si>|<si\/>/g;
      while ((m = reSi.exec(ss))) compart.push(textoDe(m[1] || ''));
    }
    const abas = [];
    const reSheet = /<sheet\b([^>]*)\/?>/g;
    let i = 0;
    while ((m = reSheet.exec(wbXml))) {
      i++;
      const tag = ' ' + m[1];
      const nome = attr(tag, 'name') || ('Aba ' + i);
      const rid = attr(tag, 'r:id');
      let alvo = rid && rels[rid] ? caminho('xl', rels[rid]) : `xl/worksheets/sheet${i}.xml`;
      if (!zip[alvo]) alvo = `xl/worksheets/sheet${i}.xml`;
      if (!zip[alvo]) continue;
      abas.push({ nome, linhas: lerAba(dec(zip[alvo]), compart) });
    }
    if (!abas.length) throw new Error('A planilha não tem nenhuma aba legível.');
    return abas;
  }

  return { lerXlsx, colunaDaRef };
});
