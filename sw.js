// service worker do RETIfica: guarda o app no aparelho (cache primeiro).
// A versão muda sozinha a cada publicação, e aí o app se atualiza.
const VERSAO = 'retifica-99da19e56c';
const ARQUIVOS = [
  "./",
  "app.js",
  "apple-touch-icon.png",
  "cdrf-core.js",
  "estilo.css",
  "fflate.umd.js",
  "icone-192.png",
  "icone-512.png",
  "icones/atualizar.png",
  "icones/buscar.png",
  "icones/cadastros.png",
  "icones/config.png",
  "icones/copiar.png",
  "icones/dados.png",
  "icones/desfazer.png",
  "icones/excluir.png",
  "icones/exportar.png",
  "icones/fechar.png",
  "icones/importar.png",
  "icones/local.png",
  "icones/lote.png",
  "icones/mestre.png",
  "icones/novo.png",
  "icones/padron_arquivo.png",
  "icones/padron_este.png",
  "icones/padron_tudo.png",
  "icones/pendencia.png",
  "icones/planilha.png",
  "icones/prefeitura.png",
  "icones/ruas.png",
  "icones/salvar.png",
  "index.html",
  "manifest.webmanifest",
  "xlsx-min.js"
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((achou) => achou || fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(VERSAO).then((c) => c.put(e.request, copia)).catch(() => {});
    return r;
  }).catch(() => caches.match('./'))));
});
