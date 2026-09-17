import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const html = read('index.html');
const js = read('app.js');
const css = read('styles.css');
const readme = read('README.md');
const migration = read('supabase/migrations/0001_orchidarium_intelligence.sql');
const seed = read('supabase/seed.sql');
const ingestionPlan = read('docs/data-ingestion.md');
const importer = read('scripts/import-catalog.mjs');
const gbifSync = read('scripts/sync-gbif-orchidaceae.mjs');
const identifyFunction = read('supabase/functions/identify-orchid/index.ts');
const ocrFunction = read('supabase/functions/ocr-label/index.ts');
const browserConfig = read('config.example.js');
const gbifWorkflow = read('.github/workflows/sync-gbif.yml');
const deployWorkflow = read('.github/workflows/deploy-supabase.yml');

assert.match(html, /lang="es"/, 'frontend should be localized for Spanish users');
assert.match(html, /data-view="identify"/, 'frontend should expose image identification workflow');
assert.match(html, /data-view="admin"/, 'frontend should expose curation workflow');
assert.match(html, /Uso responsable/, 'frontend should show responsible source/licensing warning');
assert.ok(css.includes('.oa-identify') && css.includes('.oa-admin-grid'), 'CSS should style identify and admin views');

assert.match(js, /kind: 'species'/, 'demo data should include botanical species');
assert.match(js, /kind: 'grex'/, 'demo data should include registered grexes');
assert.match(js, /kind: 'cultivar'/, 'demo data should include cultivars/clones');
assert.match(js, /IMAGE_EVIDENCE/, 'demo should include image evidence records');
assert.match(js, /photographer/, 'image evidence should retain photographer metadata');
assert.match(js, /rights/, 'image evidence should retain rights holder metadata');
assert.match(js, /probabilidades de candidato, no identificaciones absolutas/, 'UI should keep candidate results probabilistic');
assert.match(js, /rest\/v1\/rpc\/orchid_search/, 'frontend should query the Supabase search RPC when configured');
assert.match(js, /Modo demo local/, 'frontend should identify its local fallback mode');
assert.match(browserConfig, /supabaseAnonKey/, 'browser configuration should accept an anon key');
assert.doesNotMatch(browserConfig, /service_role\s*:/, 'browser configuration must not define a service-role credential');

assert.match(readme, /Do not scrape or republish restricted image\/data sources without permission/, 'README should include responsible data use guidance');
assert.match(readme, /interactive web prototype/i, 'README should document the interactive prototype');
assert.match(readme, /supabase\/seed\.sql/, 'README should explain when demo orchids can be loaded');

assert.match(migration, /create extension if not exists vector;/, 'migration should enable pgvector');
assert.match(migration, /create extension if not exists pg_trgm;/, 'migration should enable pg_trgm');
assert.match(migration, /create table species/, 'migration should model botanical species');
assert.match(migration, /create table grexes/, 'migration should model registered grexes');
assert.match(migration, /create table cultivars/, 'migration should model cultivars/clones');
assert.match(migration, /create table image_evidence/, 'migration should model image evidence');
assert.match(migration, /constraint image_license_trace_required/, 'image evidence should require license traceability');
assert.match(migration, /create or replace function grex_ancestry/, 'migration should expose recursive ancestry');
assert.match(migration, /create or replace function grex_genetic_contribution/, 'migration should expose genetic contribution');
assert.match(migration, /create or replace function match_image_embedding/, 'migration should expose vector matching');
assert.match(migration, /expert_verification = 'approved' and license_status <> 'restricted'/, 'RLS should only expose approved unrestricted images');
assert.match(seed, /Cattleya[\s\S]*dowiana/, 'seed should include a demo species');
assert.match(seed, /Rhyncholaeliocattleya Hawaiian Passion/, 'seed should include a demo registered grex');
assert.match(seed, /Sweet Afton/, 'seed should include a demo cultivar');
assert.match(seed, /image_evidence/, 'seed should include image evidence metadata');
assert.match(ingestionPlan, /Recommended load order/, 'ingestion plan should define source-to-evidence load order');
assert.match(ingestionPlan, /Do not import restricted images/, 'ingestion plan should gate restricted images');
assert.match(ingestionPlan, /--dry-run/, 'ingestion plan should document validation before writes');
assert.match(importer, /SUPABASE_SERVICE_ROLE_KEY/, 'importer should require server-only credentials');
assert.match(importer, /must not copy a restricted image/, 'importer should block restricted Storage copies');
assert.match(gbifSync, /api\.gbif\.org\/v1/, 'GBIF sync should use the public Species API');
assert.match(gbifSync, /highertaxon_key/, 'GBIF sync should restrict results to Orchidaceae');
assert.match(gbifSync, /deterministicUuid/, 'GBIF sync should produce repeatable identifiers');
assert.match(gbifSync, /gbif-cache/, 'GBIF sync should checkpoint pages for resumable downloads');
assert.match(gbifWorkflow, /workflow_dispatch:/, 'GBIF catalog build should be manually runnable');
assert.match(gbifWorkflow, /actions\/upload-artifact@v4/, 'GBIF catalog should be published as a reviewed artifact');
assert.match(deployWorkflow, /environment: supabase-staging/, 'deployment should use protected staging secrets');
assert.match(deployWorkflow, /supabase db push/, 'deployment should apply database migrations');
assert.match(deployWorkflow, /gbif-orchidaceae\.audit\.json/, 'deployment should require the audited catalog artifact');
assert.match(deployWorkflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/, 'deployment should read the service role from GitHub secrets');
assert.doesNotMatch(deployWorkflow, /SUPABASE_SERVICE_ROLE_KEY:\s*['"][A-Za-z0-9]/, 'deployment must not embed service-role credentials');

assert.match(identifyFunction, /license is required for every image/, 'identify function should enforce image license metadata');
assert.match(identifyFunction, /match_image_embedding/, 'identify function should call internal vector search');
assert.match(identifyFunction, /rerank_identification_candidates/, 'identify function should rerank candidates');
assert.match(ocrFunction, /OCR_ENDPOINT/, 'OCR function should use configurable OCR endpoint');
assert.match(ocrFunction, /orchid_search/, 'OCR function should map labels through orchid_search');

assert.doesNotMatch(html + js + readme, /sb_publishable_|SUPABASE_KEY\s*=/, 'frontend should not expose Supabase publishable keys');

console.log('Static Orchidarium checks passed');
