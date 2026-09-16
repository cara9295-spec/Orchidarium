#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const LOAD_ORDER = [
  ['sources', 'id'],
  ['genera', 'id'],
  ['species', 'id'],
  ['species_synonyms', 'species_id,synonym'],
  ['grexes', 'id'],
  ['cultivars', 'id'],
  ['cultivar_awards', 'id'],
  ['image_evidence', 'id'],
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_KINDS = new Set(['species', 'grex', 'cultivar']);

function required(record, fields, location, errors) {
  for (const field of fields) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      errors.push(`${location}.${field} is required`);
    }
  }
}

export function validateCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return ['catalog must be a JSON object'];

  for (const [table] of LOAD_ORDER) {
    const records = catalog[table] ?? [];
    if (!Array.isArray(records)) {
      errors.push(`${table} must be an array`);
      continue;
    }

    records.forEach((record, index) => {
      const location = `${table}[${index}]`;
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        errors.push(`${location} must be an object`);
        return;
      }

      required(record, ['id'], location, errors);
      if (record.id && !UUID.test(record.id)) errors.push(`${location}.id must be a UUID`);
      if (table === 'sources') required(record, ['code', 'name', 'accessed_at'], location, errors);
      if (table === 'genera') required(record, ['name', 'source_id'], location, errors);
      if (table === 'species') required(record, ['genus_id', 'genus_name', 'specific_epithet', 'source_id'], location, errors);
      if (table === 'species_synonyms') required(record, ['species_id', 'synonym', 'source_id'], location, errors);
      if (table === 'grexes') {
        required(record, ['name', 'seed_parent_kind', 'seed_parent_id', 'pollen_parent_kind', 'pollen_parent_id', 'source_id', 'source_url'], location, errors);
        if (record.seed_parent_kind && !['species', 'grex'].includes(record.seed_parent_kind)) errors.push(`${location}.seed_parent_kind must be species or grex`);
        if (record.pollen_parent_kind && !['species', 'grex'].includes(record.pollen_parent_kind)) errors.push(`${location}.pollen_parent_kind must be species or grex`);
      }
      if (table === 'cultivars') required(record, ['grex_id', 'cultivar_epithet', 'source_id', 'source_url'], location, errors);
      if (table === 'cultivar_awards') required(record, ['cultivar_id', 'award_body', 'award_code', 'source_url'], location, errors);
      if (table === 'image_evidence') {
        required(record, ['entity_kind', 'entity_id', 'license', 'license_status', 'photographer', 'rights_holder', 'access_date'], location, errors);
        if (!record.source_url && !record.storage_path) errors.push(`${location} requires source_url or storage_path`);
        if (record.entity_kind && !ENTITY_KINDS.has(record.entity_kind)) errors.push(`${location}.entity_kind is invalid`);
        if (record.license_status === 'restricted' && record.storage_path) errors.push(`${location} must not copy a restricted image into Storage`);
      }
    });
  }
  return errors;
}

const DEFAULT_BATCH_SIZE = 500;

async function upsertBatch(baseUrl, serviceKey, table, conflict, records, fetchImpl) {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(records),
  });
  if (!response.ok) throw new Error(`${table} import failed (${response.status}): ${await response.text()}`);
}

export async function importCatalog(catalog, { baseUrl, serviceKey, fetchImpl = fetch, onProgress = () => {}, batchSize = DEFAULT_BATCH_SIZE }) {
  const errors = validateCatalog(catalog);
  if (errors.length) throw new Error(`Catalog validation failed:\n- ${errors.join('\n- ')}`);
  if (!baseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');

  for (const [table, conflict] of LOAD_ORDER) {
    const records = catalog[table] ?? [];
    for (let offset = 0; offset < records.length; offset += batchSize) {
      const batch = records.slice(offset, offset + batchSize);
      await upsertBatch(baseUrl, serviceKey, table, conflict, batch, fetchImpl);
      onProgress({ table, count: batch.length, imported: offset + batch.length, total: records.length });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file) throw new Error('Usage: node scripts/import-catalog.mjs [--dry-run] <catalog.json>');

  const catalog = JSON.parse(await readFile(file, 'utf8'));
  const errors = validateCatalog(catalog);
  if (errors.length) throw new Error(`Catalog validation failed:\n- ${errors.join('\n- ')}`);

  const total = LOAD_ORDER.reduce((sum, [table]) => sum + (catalog[table]?.length ?? 0), 0);
  if (dryRun) {
    process.stdout.write(`Catalog valid: ${total} records; no database writes performed.\n`);
    return;
  }

  await importCatalog(catalog, {
    baseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    onProgress: ({ table, imported, total }) => process.stdout.write(`${table}: ${imported}/${total} imported\n`),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
