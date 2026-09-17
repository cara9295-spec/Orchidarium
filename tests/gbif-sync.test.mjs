import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalog, deterministicUuid, fetchGbifPages } from '../scripts/sync-gbif-orchidaceae.mjs';
import { auditCatalog } from '../scripts/audit-gbif-catalog.mjs';
import fixture from './fixtures/gbif-orchidaceae.json' with { type: 'json' };

test('builds a deterministic importable Orchidaceae catalog', () => {
  const first = buildCatalog({ ...fixture, accessedAt: '2026-09-14' });
  const second = buildCatalog({ ...fixture, accessedAt: '2026-09-14' });

  assert.equal(first.species.length, 2);
  assert.equal(first.genera.length, 2);
  assert.equal(first.species_synonyms.length, 1);
  assert.equal(first.species_synonyms[0].species_id, first.species.find((item) => item.gbif_taxon_key === 5319449).id);
  assert.deepEqual(first, { ...second, generated_at: first.generated_at });
  assert.equal(deterministicUuid('gbif:species:5318901'), deterministicUuid('gbif:species:5318901'));
});

test('derives a missing specific epithet from a GBIF canonical name', () => {
  const catalog = buildCatalog({
    accepted: [{
      key: 123,
      genusKey: 12,
      genus: 'Cattleya',
      canonicalName: 'Cattleya dowiana',
      scientificName: 'Cattleya dowiana Bateman',
      authorship: 'Bateman',
    }],
    synonyms: [],
    accessedAt: '2026-09-16',
  });

  assert.equal(catalog.genera.length, 1);
  assert.equal(catalog.species.length, 1);
  assert.equal(catalog.species[0].genus_name, 'Cattleya');
  assert.equal(catalog.species[0].specific_epithet, 'dowiana');
});

test('paginates GBIF responses and honors a record limit', async () => {
  const requested = [];
  const pages = [
    { results: [{ key: 1 }, { key: 2 }], endOfRecords: false },
    { results: [{ key: 3 }], endOfRecords: true },
  ];
  const fetchImpl = async (url) => {
    requested.push(new URL(url));
    return { ok: true, json: async () => pages.shift(), text: async () => '' };
  };

  const records = await fetchGbifPages({ status: 'ACCEPTED', familyKey: 7689, maxRecords: 3, fetchImpl });
  assert.deepEqual(records.map(({ key }) => key), [1, 2, 3]);
  assert.equal(requested.length, 2);
  assert.equal(requested[0].searchParams.get('highertaxon_key'), '7689');
  assert.equal(requested[0].searchParams.get('status'), 'ACCEPTED');
  assert.equal(requested[1].searchParams.get('offset'), '2');
});

test('resumes from cached GBIF pages without requesting them again', async () => {
  let networkCalls = 0;
  const records = await fetchGbifPages({
    status: 'ACCEPTED',
    maxRecords: 2,
    readPage: async () => ({ results: [{ key: 1 }, { key: 2 }], count: 2, endOfRecords: true }),
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error('network should not be called');
    },
  });
  assert.equal(records.length, 2);
  assert.equal(networkCalls, 0);
});

test('audits catalog size and referential integrity', () => {
  const catalog = buildCatalog({ ...fixture, accessedAt: '2026-09-14' });
  assert.equal(auditCatalog(catalog, { minimumSpecies: 2, minimumSynonyms: 1 }).valid, true);

  catalog.species_synonyms[0].species_id = deterministicUuid('missing-species');
  const audit = auditCatalog(catalog, { minimumSpecies: 3, minimumSynonyms: 2 });
  assert.equal(audit.valid, false);
  assert.match(audit.errors.join('\n'), /references missing species/);
  assert.match(audit.errors.join('\n'), /Expected at least 3 accepted species/);
  assert.match(audit.errors.join('\n'), /Expected at least 2 linked synonyms/);
});
