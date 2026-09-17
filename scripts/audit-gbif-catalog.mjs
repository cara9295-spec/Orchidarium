#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function auditCatalog(catalog, { minimumSpecies = 0, minimumSynonyms = 0 } = {}) {
  const genera = Array.isArray(catalog?.genera) ? catalog.genera : [];
  const species = Array.isArray(catalog?.species) ? catalog.species : [];
  const synonyms = Array.isArray(catalog?.species_synonyms) ? catalog.species_synonyms : [];
  const genusIds = new Set(genera.map((record) => record.id));
  const speciesIds = new Set(species.map((record) => record.id));
  const gbifKeys = new Set();
  const errors = [];

  for (const record of species) {
    if (!genusIds.has(record.genus_id)) errors.push(`Species ${record.id} references missing genus ${record.genus_id}`);
    if (gbifKeys.has(record.gbif_taxon_key)) errors.push(`Duplicate GBIF taxon key ${record.gbif_taxon_key}`);
    gbifKeys.add(record.gbif_taxon_key);
  }
  for (const record of synonyms) {
    if (!speciesIds.has(record.species_id)) errors.push(`Synonym ${record.id} references missing species ${record.species_id}`);
  }
  if (species.length < minimumSpecies) errors.push(`Expected at least ${minimumSpecies} accepted species; found ${species.length}`);
  if (synonyms.length < minimumSynonyms) errors.push(`Expected at least ${minimumSynonyms} linked synonyms; found ${synonyms.length}`);

  return {
    valid: errors.length === 0,
    errors,
    counts: { genera: genera.length, accepted_species: species.length, linked_synonyms: synonyms.length },
  };
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((argument) => !argument.startsWith('--'));
  if (!file) throw new Error('Usage: node scripts/audit-gbif-catalog.mjs <catalog.json> [--minimum-species N] [--minimum-synonyms N] [--report path]');

  const bytes = await readFile(file);
  const catalog = JSON.parse(bytes);
  const minimumSpecies = Number(option(args, '--minimum-species', '0'));
  const minimumSynonyms = Number(option(args, '--minimum-synonyms', '0'));
  if (!Number.isInteger(minimumSpecies) || minimumSpecies < 0 || !Number.isInteger(minimumSynonyms) || minimumSynonyms < 0) {
    throw new Error('Minimum counts must be non-negative integers');
  }

  const audit = auditCatalog(catalog, { minimumSpecies, minimumSynonyms });
  const report = {
    generated_at: catalog.generated_at,
    audited_at: new Date().toISOString(),
    source_file: file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...audit,
  };
  const reportPath = option(args, '--report');
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!audit.valid) throw new Error(`Catalog audit failed:\n- ${audit.errors.join('\n- ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
