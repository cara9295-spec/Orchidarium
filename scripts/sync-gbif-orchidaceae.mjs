#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const API_ROOT = 'https://api.gbif.org/v1';
const ORCHIDACEAE_KEY = 7689;
const PAGE_SIZE = 1000;
const UUID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function uuidBytes(uuid) {
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

export function deterministicUuid(name) {
  const hash = createHash('sha1').update(uuidBytes(UUID_NAMESPACE)).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchJson(url, fetchImpl, retries = 4) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'Orchidarium/0.1 taxonomy sync' } });
      if (response.ok) return response.json();
      const body = await response.text();
      if (response.status < 500 && response.status !== 429) throw new Error(`GBIF request failed (${response.status}) for ${url}: ${body}`);
      lastError = new Error(`GBIF request failed (${response.status}) for ${url}: ${body}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await wait(500 * (2 ** attempt));
  }
  throw lastError;
}

export async function fetchGbifPages({ status, familyKey = ORCHIDACEAE_KEY, maxRecords = Infinity, fetchImpl = fetch, readPage, writePage, onProgress = () => {} }) {
  const records = [];
  let offset = 0;
  while (records.length < maxRecords) {
    const limit = Math.min(PAGE_SIZE, maxRecords - records.length);
    const query = new URLSearchParams({
      highertaxon_key: String(familyKey),
      rank: 'SPECIES',
      status,
      limit: String(limit),
      offset: String(offset),
    });
    let page = await readPage?.({ status, offset });
    if (!page) {
      page = await fetchJson(`${API_ROOT}/species/search?${query}`, fetchImpl);
      await writePage?.({ status, offset, page });
    }
    const results = Array.isArray(page.results) ? page.results : [];
    records.push(...results);
    onProgress({ status, downloaded: records.length, total: page.count });
    if (page.endOfRecords || results.length === 0) break;
    offset += results.length;
  }
  return records.slice(0, maxRecords);
}

export function buildCatalog({ accepted, synonyms, accessedAt = new Date().toISOString().slice(0, 10) }) {
  const sourceId = deterministicUuid('source:gbif-species-api');
  const generaByName = new Map();
  const speciesByKey = new Map();

  for (const taxon of accepted) {
    if (!taxon.key || !taxon.genus || !taxon.specificEpithet) continue;
    const genusId = deterministicUuid(`gbif:genus:${taxon.genusKey ?? taxon.genus}`);
    generaByName.set(taxon.genus, {
      id: genusId,
      name: taxon.genus,
      source_id: sourceId,
    });
    speciesByKey.set(Number(taxon.key), {
      id: deterministicUuid(`gbif:species:${taxon.key}`),
      genus_id: genusId,
      genus_name: taxon.genus,
      specific_epithet: taxon.specificEpithet,
      authorship: taxon.authorship || null,
      gbif_taxon_key: Number(taxon.key),
      source_id: sourceId,
    });
  }

  const seenSynonyms = new Set();
  const normalizedSynonyms = [];
  for (const synonym of synonyms) {
    const acceptedSpecies = speciesByKey.get(Number(synonym.acceptedKey));
    const name = synonym.canonicalName || synonym.scientificName;
    if (!acceptedSpecies || !name) continue;
    const dedupeKey = `${acceptedSpecies.id}:${name.toLowerCase()}`;
    if (seenSynonyms.has(dedupeKey)) continue;
    seenSynonyms.add(dedupeKey);
    normalizedSynonyms.push({
      id: deterministicUuid(`gbif:synonym:${synonym.key ?? dedupeKey}`),
      species_id: acceptedSpecies.id,
      synonym: name,
      source_id: sourceId,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    scope: { family: 'Orchidaceae', gbif_family_key: ORCHIDACEAE_KEY },
    sources: [{
      id: sourceId,
      code: 'GBIF-SPECIES-API',
      name: 'GBIF Species API',
      url: `${API_ROOT}/species/search`,
      license: 'GBIF terms and source-dataset licenses apply',
      notes: 'Automated Orchidaceae taxonomy snapshot; review against WCVP/POWO before curatorial approval.',
      accessed_at: accessedAt,
    }],
    genera: [...generaByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    species: [...speciesByKey.values()].sort((a, b) => a.gbif_taxon_key - b.gbif_taxon_key),
    species_synonyms: normalizedSynonyms,
    grexes: [],
    cultivars: [],
    cultivar_awards: [],
    image_evidence: [],
  };
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const output = option(args, '--output', 'data/generated/gbif-orchidaceae.json');
  const fixture = option(args, '--fixture');
  const maxRecords = Number(option(args, '--limit', 'Infinity'));
  const cacheDir = option(args, '--cache-dir', 'data/generated/gbif-cache');
  if (!(maxRecords > 0)) throw new Error('--limit must be a positive number');

  let accepted;
  let synonyms;
  if (fixture) {
    const payload = JSON.parse(await readFile(fixture, 'utf8'));
    ({ accepted = [], synonyms = [] } = payload);
  } else {
    await mkdir(cacheDir, { recursive: true });
    const readPage = async ({ status, offset }) => {
      try {
        return JSON.parse(await readFile(`${cacheDir}/${status.toLowerCase()}-${offset}.json`, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    };
    const writePage = async ({ status, offset, page }) => writeFile(`${cacheDir}/${status.toLowerCase()}-${offset}.json`, JSON.stringify(page));
    const onProgress = ({ status, downloaded, total }) => process.stdout.write(`${status}: ${downloaded}${total ? `/${total}` : ''} records cached\n`);
    accepted = await fetchGbifPages({ status: 'ACCEPTED', maxRecords, readPage, writePage, onProgress });
    synonyms = await fetchGbifPages({ status: 'SYNONYM', maxRecords, readPage, writePage, onProgress });
  }

  const catalog = buildCatalog({ accepted, synonyms });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`);
  process.stdout.write(`GBIF catalog written to ${output}: ${catalog.genera.length} genera, ${catalog.species.length} accepted species, ${catalog.species_synonyms.length} synonyms.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
