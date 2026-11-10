/* xlsx-min.js — escreve um .xlsx simples (várias abas, cabeçalho colorido,
 * painéis congelados, larguras de coluna) sem nenhuma dependência de rede.
 * Usa só o fflate (zip). Células de texto vão como texto; números, como número.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fflate.umd.js'));
  else root.XLSXMin = factory(root.fflate);
})(typeof self !== 'undefined' ? self : this, function (fflate) {
  'use strict';

  const esc = (s) => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function letra(n) {            // 1 -> A, 27 -> AA
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function xmlAba(aba) {
    const nc = aba.cabecalho.length;
    const nl = aba.linhas.length + 1;
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<dimension ref="A1:${letra(nc)}${nl}"/>`;
    const cg = aba.congelar || { linhas: 0, colunas: 0 };
    if (cg.linhas || cg.colunas) {
      const tl = letra(cg.colunas + 1) + (cg.linhas + 1);
      const painel = cg.linhas && cg.colunas ? 'bottomRight' : (cg.linhas ? 'bottomLeft' : 'topRight');
      x += '<sheetViews><sheetView workbookViewId="0"><pane' +
        (cg.colunas ? ` xSplit="${cg.colunas}"` : '') + (cg.linhas ? ` ySplit="${cg.linhas}"` : '') +
        ` topLeftCell="${tl}" activePane="${painel}" state="frozen"/><selection pane="${painel}"/></sheetView></sheetViews>`;
    }
    x += '<sheetFormatPr defaultRowHeight="15"/>';
    if (aba.larguras && aba.larguras.length) {
      x += '<cols>' + aba.larguras.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    }
    x += '<sheetData>';
    x += '<row r="1">' + aba.cabecalho.map((t, i) =>
      `<c r="${letra(i + 1)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`).join('') + '</row>';
    aba.linhas.forEach((linha, r) => {
      const rn = r + 2;
      let cel = '';
      linha.forEach((v, i) => {
        if (v === '' || v === null || v === undefined) return;
        const ref = letra(i + 1) + rn;
        if (typeof v === 'number' && Number.isFinite(v)) cel += `<c r="${ref}"><v>${v}</v></c>`;
        else cel += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      });
      x += `<row r="${rn}">${cel}</row>`;
    });
    x += '</sheetData>';
    x += '</worksheet>';
    return x;
  }

  function criarXlsx(abas) {
    const enc = fflate.strToU8;
    const f = {};
    f['[Content_Types].xml'] = enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>');
    f['_rels/.rels'] = enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    f['xl/workbook.xml'] = enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + abas.map((a, i) => `<sheet name="${esc(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
    f['xl/_rels/workbook.xml.rels'] = enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    f['xl/styles.xml'] = enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF305496"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    abas.forEach((a, i) => { f[`xl/worksheets/sheet${i + 1}.xml`] = enc(xmlAba(a)); });
    return fflate.zipSync(f, { level: 6 });
  }

  return { criarXlsx };
});
