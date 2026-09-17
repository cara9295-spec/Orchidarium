# Verified catalog snapshots

This log records successful, externally generated catalogs without committing
the large generated JSON files to Git. Counts describe the normalized artifact,
not a curator-approved WCVP/POWO treatment.

| Generated (UTC) | Source | Genera | Accepted species | Linked synonyms | Status |
| --- | --- | ---: | ---: | ---: | --- |
| 2026-09-16T23:44:39.217Z | GBIF Species API | 833 | 33,355 | 42,536 | Downloaded and structurally validated by GitHub Actions |

Before importing a downloaded snapshot, retain its accompanying audit report
and run both `npm run catalog:audit` and the importer in `--dry-run` mode. GBIF
records remain pending reconciliation with WCVP/POWO and must not be presented
as curator-approved taxonomy merely because they passed structural validation.
