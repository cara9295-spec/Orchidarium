# Orchidarium

Hybrid-first orchid intelligence platform blueprint, Supabase backend, and interactive web prototype.

Orchidarium separates botanical Orchidaceae species from horticultural grexes and cultivars/clones while keeping every identification probabilistic and evidence-backed.

## Core capabilities

- Taxonomy backbone for Orchidaceae species from WCVP/POWO and GBIF.
- Registered grexes with seed parent, pollen parent, registrant, originator, registration date, and source evidence.
- Cultivars/clones linked to grexes with awards and curated evidence.
- Recursive parentage graph and genetic contribution calculations.
- Image evidence with source URL, license, photographer, rights holder, access date, perceptual hash, quality signals, verification state, and pgvector embeddings.
- Search across species, synonyms, grexes, cultivars, parentage, abbreviations, fuzzy spelling, and full text.
- OCR workflow for plant labels in uploads.
- Image identification workflow combining PlantNet, Plant.id, internal vector search, parentage-aware reranking, and confidence explanations.
- Admin curation for labels, duplicate grexes, parentage, license status, and doubtful identifications.
- Interactive public UI prototype for search, species/grex/cultivar profiles, parentage trees, similar orchids, upload identification, evidence panels, and curation queues.

## Supabase architecture

- `supabase/migrations/0001_orchidarium_intelligence.sql` defines extensions, tables, indexes, RLS, recursive ancestry, genetic contribution, search, vector similarity, and reranking functions.
- `supabase/functions/ocr-label/index.ts` stores OCR jobs and calls a configurable OCR endpoint.
- `supabase/functions/identify-orchid/index.ts` stores upload evidence, records external provider candidates, calls internal vector search, reranks candidates, and returns probabilistic explanations.

The project intentionally stores provenance and rights metadata for every image. Do not scrape or republish restricted image/data sources without permission.

## Frontend prototype

The static frontend is split into `index.html`, `styles.css`, and `app.js`. It includes in-memory demonstration records for botanical species, registered grexes, and cultivars/clones so the hybrid-first workflows can be explored without a live Supabase project. The demo intentionally labels all identification output as probabilistic and displays source/licensing fields in evidence panels.


## Loading orchid data

Demo orchid records can be loaded now with `supabase/seed.sql` after applying the migration. Production loading should follow `docs/data-ingestion.md`: confirm WCVP/POWO, GBIF, RHS/IOR, award, nursery, and image-source permissions first; load sources, genera, species, synonyms, grexes, cultivars, awards, then permitted image evidence.

Validate a normalized, authorized import batch with `npm run import:check` or `node scripts/import-catalog.mjs --dry-run <catalog.json>`. Database writes require server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables; the key is never used by the public frontend.

`npm run catalog:gbif` now builds a real Orchidaceae species/synonym catalog from the public GBIF Species API without downloading images. Validate the generated file before importing it, and reconcile it with WCVP/POWO before marking records curator-approved.

Large downloads are resumable through page checkpoints, and large Supabase imports are split into 500-row requests. `.github/workflows/sync-gbif.yml` also runs the full catalog build monthly or manually and exposes the validated JSON as an artifact for curatorial review.

## Connect the public search

Copy `config.example.js` to the ignored `config.js` and set the Supabase project URL plus its browser-safe anon/publishable key. The search UI will then call the `orchid_search` RPC and label its connection state; without configuration, or if the request fails, it remains in an explicitly marked local demo mode. Never place a service-role key in this file.

## Testing

Run `npm test` to execute static checks that guard the prototype, schema, Edge Functions, provenance requirements, probabilistic-identification language, and the absence of exposed Supabase keys in frontend files.
