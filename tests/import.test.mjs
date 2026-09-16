import assert from 'node:assert/strict';
import test from 'node:test';
import { importCatalog, LOAD_ORDER, validateCatalog } from '../scripts/import-catalog.mjs';

const sourceOnly = {
  sources: [{ id: '00000000-0000-4000-8000-000000000010', code: 'TEST', name: 'Test source', accessed_at: '2026-07-24' }],
};

test('validates a minimal source catalog', () => {
  assert.deepEqual(validateCatalog(sourceOnly), []);
});

test('rejects copied restricted images and incomplete provenance', () => {
  const catalog = {
    image_evidence: [{
      id: '50000000-0000-4000-8000-000000000001',
      entity_kind: 'species',
      entity_id: '20000000-0000-4000-8000-000000000001',
      storage_path: 'restricted/photo.jpg',
      license_status: 'restricted',
    }],
  };
  const errors = validateCatalog(catalog).join('\n');
  assert.match(errors, /license is required/);
  assert.match(errors, /must not copy a restricted image/);
});

test('imports tables in dependency order with service-role authentication', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 201, text: async () => '' };
  };

  await importCatalog(sourceOnly, {
    baseUrl: 'https://project.supabase.co/',
    serviceKey: 'server-secret',
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /sources\?on_conflict=id$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-secret');
  assert.deepEqual(LOAD_ORDER.map(([table]) => table).slice(0, 4), ['sources', 'genera', 'species', 'species_synonyms']);
});

test('imports large catalogs in bounded batches', async () => {
  const sources = Array.from({ length: 1201 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    code: `SOURCE-${index}`,
    name: `Source ${index}`,
    accessed_at: '2026-09-16',
  }));
  const calls = [];
  await importCatalog({ sources }, {
    baseUrl: 'https://project.supabase.co',
    serviceKey: 'server-secret',
    batchSize: 500,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body).length);
      return { ok: true, status: 201, text: async () => '' };
    },
  });
  assert.deepEqual(calls, [500, 500, 201]);
});
