const DATA = {
  species: [
    { id: 'sp-cdow', kind: 'species', name: 'Cattleya dowiana', authority: 'Bateman & Rchb.f.', aliases: ['C. dowiana', 'Cattleya aurea'], region: 'Costa Rica, Panamá y Colombia', source: 'WCVP/POWO + GBIF', license: 'Taxonomic metadata; no republished restricted images', description: 'Especie botánica separada de grexes hortícolas. Útil como ancestro en linajes Cattleya amarillos.' },
    { id: 'sp-rdig', kind: 'species', name: 'Rhyncholaelia digbyana', authority: '(Lindl.) Schltr.', aliases: ['R. digbyana', 'Brassavola digbyana'], region: 'México, Belice, Guatemala, Honduras', source: 'WCVP/POWO + GBIF', license: 'Taxonomic metadata; no republished restricted images', description: 'Especie con labelo fimbriado, frecuente en parentajes de híbridos complejos.' }
  ],
  grexes: [
    { id: 'gx-hawaii', kind: 'grex', name: 'Rhyncholaeliocattleya Hawaiian Passion', aliases: ['Rlc. Hawaiian Passion'], seed: 'Rlc. Memoria Helen Brown', pollen: 'C. Circle of Life', registrant: 'Demo registry import', originator: 'Demo originator', date: '2018-05-16', source: 'RHS-style registry evidence', verification: 'unreviewed', description: 'Grex registrado modelado con padre semilla y padre polen. El parentaje alimenta reranking visual.' },
    { id: 'gx-helen', kind: 'grex', name: 'Rhyncholaeliocattleya Memoria Helen Brown', aliases: ['Rlc. Memoria Helen Brown', 'Blc. Mem. Helen Brown'], seed: 'Cattleya dowiana', pollen: 'Rhyncholaelia digbyana', registrant: 'Demo registry import', originator: 'Demo originator', date: '1967-01-01', source: 'RHS-style registry evidence', verification: 'approved', description: 'Grex ancestral de ejemplo con fuerte contribución de especies botánicas.' }
  ],
  cultivars: [
    { id: 'cv-sweet', kind: 'cultivar', name: "Rlc. Memoria Helen Brown 'Sweet Afton'", aliases: ['Sweet Afton', 'Mem Helen Brown Sweet Afton'], grex: 'Rhyncholaeliocattleya Memoria Helen Brown', awards: ['AOS/HCC demo evidence'], source: 'Award/cultivar evidence record', verification: 'doubtful', description: 'Cultivar/clon vinculado al grex, no tratado como especie ni como grex independiente.' }
  ]
};

const IMAGE_EVIDENCE = [
  { entity: 'Rlc. Memoria Helen Brown Sweet Afton', view: 'flower', license: 'CC BY 4.0 demo', photographer: 'Curator demo', rights: 'Orchidarium sample', url: 'https://example.org/evidence/sweet-afton', accessed: '2026-07-22', quality: 0.84, label: 0.78, status: 'doubtful' },
  { entity: 'Cattleya dowiana', view: 'plant_label', license: 'Permitted demo', photographer: 'Nursery demo', rights: 'Nursery demo', url: 'https://example.org/evidence/c-dowiana-label', accessed: '2026-07-22', quality: 0.61, label: 0.88, status: 'approved' }
];

const CURATION_QUEUE = [
  { title: 'Etiqueta OCR: “Blc. Mem Helen Brown”', type: 'approve/reject label', risk: 'Abreviatura histórica necesita normalización a Rlc.' },
  { title: 'Grex duplicado: Hawaiian Passion', type: 'merge duplicate grex', risk: 'Coincidencia fuzzy alta; falta comprobar registrante.' },
  { title: 'Licencia pendiente: foto de flor', type: 'mark license status', risk: 'No publicar hasta confirmar derechos.' },
  { title: 'Parentaje no verificado', type: 'verify parentage', risk: 'Seed/pollen parents importados de fuente secundaria.' }
];

const app = document.getElementById('app');
const allRecords = [...DATA.species, ...DATA.grexes, ...DATA.cultivars];
const recordsById = new Map(allRecords.map(record => [record.id, record]));
const chips = ['Cattleya dowiana', 'Rlc. Hawaiian Passion', 'Sweet Afton', 'Blc. Mem. Helen Brown'];
const backend = window.ORCHIDARIUM_CONFIG || {};
const hasBackend = Boolean(backend.supabaseUrl && backend.supabaseAnonKey);

document.getElementById('connectionStatus').textContent = hasBackend ? 'Supabase conectado' : 'Modo demo local';

async function searchSupabase(query) {
  const endpoint = `${backend.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/orchid_search`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: backend.supabaseAnonKey,
      Authorization: `Bearer ${backend.supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, max_results: 25 }),
  });
  if (!response.ok) throw new Error(`Supabase respondió ${response.status}`);
  const rows = await response.json();
  return rows.map(row => {
    const record = {
      id: row.entity_id,
      kind: row.entity_kind,
      name: row.label,
      description: `Coincidencia: ${row.match_reason}. Registro consultado en Supabase.`,
      source: 'Catálogo Orchidarium en Supabase',
      remote: true,
    };
    recordsById.set(record.id, record);
    return { record, score: Math.max(0, Math.min(1, Number(row.rank_score) || 0)) };
  });
}

function normalize(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreRecord(record, query) {
  const q = normalize(query);
  const haystack = normalize([record.name, record.description, record.region, record.grex, record.seed, record.pollen, ...(record.aliases || [])].filter(Boolean).join(' '));
  if (!q) return 0;
  if (haystack.includes(q)) return 1;
  const qParts = q.split(' ');
  const hits = qParts.filter(part => haystack.includes(part)).length;
  return hits / qParts.length;
}

function renderHome() {
  app.innerHTML = document.getElementById('homeTemplate').innerHTML;
  const row = app.querySelector('[data-chip-row]');
  row.innerHTML = chips.map(chip => `<button class="oa-chip" type="button" data-query="${chip}">${chip}</button>`).join('');
  bindSearch();
}

function bindSearch() {
  app.querySelectorAll('[data-search-form]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      renderSearch(new FormData(form).get('q'));
    });
  });
  app.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => renderSearch(button.dataset.query)));
}

async function renderSearch(query = '') {
  const localResults = () => allRecords.map(record => ({ record, score: scoreRecord(record, query) })).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score);
  app.innerHTML = `
    <section>
      <div class="oa-section-head"><div><p class="oa-eyebrow">Búsqueda híbrida</p><h2>Resultados</h2></div><p>Consulta especies, sinónimos, grexes, cultivares, parentales, abreviaturas y errores aproximados. En producción esto llama al RPC <code>orchid_search</code>.</p></div>
      <form class="oa-search" data-search-form><input name="q" value="${escapeHtml(query)}" autocomplete="off"><button>Buscar</button></form>
      <div class="oa-data-state">${hasBackend ? 'Consultando catálogo Supabase' : 'Datos demostrativos locales'}</div>
      <div class="oa-results" id="searchResults"><article class="oa-card"><h3>${hasBackend ? 'Consultando…' : 'Resultados demo'}</h3></article></div>
    </section>`;
  bindSearch();
  let results;
  let error = '';
  if (hasBackend && query) {
    try {
      results = await searchSupabase(query);
    } catch (reason) {
      error = `<p class="warn">No se pudo consultar Supabase (${escapeHtml(reason.message)}). Se muestran resultados demo claramente identificados.</p>`;
      results = localResults();
    }
  } else {
    results = localResults();
  }
  document.getElementById('searchResults').innerHTML = `${error}${results.map(({ record, score }) => resultCard(record, score)).join('') || emptyState(query)}`;
  app.querySelectorAll('[data-record]').forEach(card => card.addEventListener('click', () => renderProfile(card.dataset.record)));
}

function resultCard(record, score) {
  return `<article class="oa-card" data-record="${escapeHtml(record.id)}"><header><div><span class="oa-badge">${escapeHtml(record.kind)}</span><h3>${escapeHtml(record.name)}</h3></div><span class="oa-type">${Math.round(score * 100)}%</span></header><p>${escapeHtml(record.description)}</p><p><strong>Fuente:</strong> ${escapeHtml(record.source || 'evidencia curada')}</p></article>`;
}

function emptyState(query) {
  return `<article class="oa-card"><h3>Sin coincidencias para “${escapeHtml(query)}”</h3><p>Prueba con una abreviatura como Rlc., una especie como Cattleya dowiana o un clon como Sweet Afton.</p></article>`;
}

function renderProfile(id) {
  const record = recordsById.get(id);
  const evidence = record.remote ? [] : IMAGE_EVIDENCE.filter(item => normalize(item.entity).includes(normalize(record.name.split("'")[0])) || normalize(record.name).includes(normalize(item.entity.split(' ')[0])));
  app.innerHTML = `
    <section class="oa-detail">
      <div class="oa-orchid-art" aria-hidden="true">❋</div>
      <article class="oa-panel">
        <button class="oa-chip" type="button" data-back>← volver</button>
        <p class="oa-eyebrow">${escapeHtml(record.kind)}</p>
        <h1>${escapeHtml(record.name)}</h1>
        <p>${escapeHtml(record.description)}</p>
        ${profileFacts(record)}
        <div class="oa-tabs"><button data-view-part="evidence">Evidencia</button><button data-view-part="tree">Parentaje</button><button data-view-part="similar">Similares</button></div>
        <div id="profilePart">${record.remote ? '<p class="warn">Perfil básico desde búsqueda real. Los detalles taxonómicos y la evidencia se conectarán en la siguiente etapa.</p>' : evidencePanel(evidence)}</div>
      </article>
    </section>`;
  app.querySelector('[data-back]').addEventListener('click', () => renderSearch(record.name));
  app.querySelectorAll('[data-view-part]').forEach(button => button.addEventListener('click', () => {
    const part = button.dataset.viewPart;
    document.getElementById('profilePart').innerHTML = part === 'tree' ? parentTree(record) : part === 'similar' ? similarPanel(record) : record.remote ? '<p class="warn">No hay evidencia pública aprobada asociada a este resultado.</p>' : evidencePanel(evidence);
  }));
}

function profileFacts(record) {
  const rows = [];
  if (record.authority) rows.push(['Autoría', record.authority]);
  if (record.region) rows.push(['Distribución', record.region]);
  if (record.seed) rows.push(['Padre semilla', record.seed]);
  if (record.pollen) rows.push(['Padre polen', record.pollen]);
  if (record.grex) rows.push(['Grex', record.grex]);
  if (record.awards) rows.push(['Premios', record.awards.join(', ')]);
  if (record.verification) rows.push(['Verificación', record.verification]);
  return `<div class="oa-evidence">${rows.map(([k, v]) => `<div><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</div>`).join('')}</div>`;
}

function evidencePanel(evidence) {
  const rows = evidence.length ? evidence : IMAGE_EVIDENCE;
  return `<div class="oa-evidence">${rows.map(item => `<div><strong>${item.entity}</strong><br>Vista: ${item.view} · licencia: ${item.license} · fotógrafo: ${item.photographer}<br>Derechos: ${item.rights} · acceso: ${item.accessed} · estado: ${item.status}<br><small>${item.url}</small></div>`).join('')}</div>`;
}

function parentTree(record) {
  if (record.kind === 'species') return `<div class="oa-tree">${escapeHtml(record.name)}\n└─ especie botánica: sin parentales horticulturales.</div>`;
  if (record.kind === 'cultivar') return `<div class="oa-tree">${record.name}\n└─ cultivar/clon de ${record.grex}\n   ├─ premios y evidencia ligados al clon\n   └─ parentaje heredado del grex registrado</div>`;
  return `<div class="oa-tree">${record.name}\n├─ seed: ${record.seed} (50%)\n│  ├─ Cattleya dowiana (25%)\n│  └─ Rhyncholaelia digbyana (25%)\n└─ pollen: ${record.pollen} (50%)\n   └─ contribución calculada recursivamente</div>`;
}

function similarPanel(record) {
  const candidates = allRecords.filter(item => item.id !== record.id).slice(0, 3);
  return `<div>${candidates.map((item, index) => `<div class="oa-candidate"><div><strong>${item.name}</strong><br><small>Similitud demo por texto + parentaje; en producción usa pgvector.</small></div><span class="oa-score">${82 - index * 9}%</span></div>`).join('')}<p class="warn">Estos porcentajes son probabilidades de candidato, no identificaciones absolutas.</p></div>`;
}

function renderIdentify() {
  app.innerHTML = `<section class="oa-identify"><div class="oa-drop"><p class="oa-eyebrow">Upload identification</p><h2>Sube foto o etiqueta</h2><p>El prototipo simula OCR + PlantNet/Plant.id + similitud interna + reranking por parentaje.</p><input type="file" accept="image/*"><button class="oa-action" id="runIdentify">Simular identificación</button></div><aside class="oa-panel" id="identifyOutput"><h3>Esperando imagen</h3><p class="warn">Antes de procesar, la imagen debe registrar licencia, fotógrafo, titular de derechos, URL/fuente y fecha de acceso.</p></aside></section>`;
  document.getElementById('runIdentify').addEventListener('click', () => {
    document.getElementById('identifyOutput').innerHTML = `<h3>Candidatos probabilísticos</h3>${[
      ['Rlc. Hawaiian Passion', '72%', 'Plant.id + vector interno + parentaje compatible'],
      ['Rlc. Memoria Helen Brown', '64%', 'OCR detectó “Mem Helen Brown”; grex ancestral probable'],
      ['Cattleya dowiana', '38%', 'Coincidencia de color y presencia en ancestros']
    ].map(([name, score, why]) => `<div class="oa-candidate"><div><strong>${name}</strong><br><small>${why}</small></div><span class="oa-score">${score}</span></div>`).join('')}<p class="warn">Resultado no absoluto: requiere revisión si la etiqueta, licencia o parentaje son dudosos.</p>`;
  });
}

function renderAdmin() {
  app.innerHTML = `<section><div class="oa-section-head"><div><p class="oa-eyebrow">Admin curation</p><h2>Cola experta</h2></div><p>Acciones de back office necesarias para convertir evidencia en conocimiento confiable.</p></div><div class="oa-admin-grid">${CURATION_QUEUE.map(item => `<article><span class="oa-badge">${item.type}</span><h3>${item.title}</h3><p>${item.risk}</p><div class="oa-admin-actions"><button class="approve">Aprobar</button><button class="reject">Rechazar / dudoso</button></div></article>`).join('')}</div></section>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

document.getElementById('homeButton').addEventListener('click', renderHome);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.view === 'identify') renderIdentify();
  else if (button.dataset.view === 'admin') renderAdmin();
  else renderSearch('');
}));

renderHome();
