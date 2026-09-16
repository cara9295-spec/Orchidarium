-- Demo seed data for local Supabase development.
-- Run after migrations with: supabase db reset or psql -f supabase/seed.sql

insert into sources (id, code, name, url, license, notes, accessed_at) values
  ('00000000-0000-4000-8000-000000000001', 'POWO', 'Plants of the World Online', 'https://powo.science.kew.org', 'Metadata terms vary by dataset; verify before reuse', 'Botanical taxonomy backbone source for species records.', current_date),
  ('00000000-0000-4000-8000-000000000002', 'GBIF', 'Global Biodiversity Information Facility', 'https://www.gbif.org', 'Dataset-specific licenses must be preserved', 'Occurrence and media metadata source.', current_date),
  ('00000000-0000-4000-8000-000000000003', 'RHS-IOR', 'International Orchid Register', 'https://apps.rhs.org.uk/horticulturaldatabase/orchidregister/orchidregister.asp', 'Registry data: verify permitted use before republication', 'Authority source for registered orchid grexes.', current_date),
  ('00000000-0000-4000-8000-000000000004', 'AOS-DEMO', 'American Orchid Society award evidence demo', 'https://www.aos.org', 'Restricted/demo placeholder; do not republish images', 'Award/cultivar evidence placeholder for local development.', current_date)
on conflict (code) do update set
  name = excluded.name,
  url = excluded.url,
  license = excluded.license,
  notes = excluded.notes,
  accessed_at = excluded.accessed_at;

insert into genera (id, name, standard_abbreviation, source_id) values
  ('10000000-0000-4000-8000-000000000001', 'Cattleya', 'C.', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Rhyncholaelia', 'R.', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'Rhyncholaeliocattleya', 'Rlc.', '00000000-0000-4000-8000-000000000003')
on conflict (name) do update set standard_abbreviation = excluded.standard_abbreviation;

insert into species (id, genus_id, genus_name, specific_epithet, authorship, powo_id, gbif_taxon_key, wcvp_id, distribution, conservation_status, source_id) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Cattleya', 'dowiana', 'Bateman & Rchb.f.', 'urn:lsid:ipni.org:names:demo-cattleya-dowiana', 5318901, 'wcvp-demo-cattleya-dowiana', array['CR','PA','CO'], 'not_evaluated', '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Rhyncholaelia', 'digbyana', '(Lindl.) Schltr.', 'urn:lsid:ipni.org:names:demo-rhyncholaelia-digbyana', 5319449, 'wcvp-demo-rhyncholaelia-digbyana', array['MX','BZ','GT','HN'], 'not_evaluated', '00000000-0000-4000-8000-000000000001')
on conflict (id) do update set authorship = excluded.authorship, distribution = excluded.distribution;

insert into species_synonyms (species_id, synonym, source_id) values
  ('20000000-0000-4000-8000-000000000001', 'Cattleya aurea', '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Brassavola digbyana', '00000000-0000-4000-8000-000000000001')
on conflict (species_id, synonym) do nothing;

insert into grexes (id, name, genus_id, seed_parent_kind, seed_parent_id, pollen_parent_kind, pollen_parent_id, registrant, originator, registration_date, rhs_registration_number, source_id, source_url, verification, notes) values
  ('30000000-0000-4000-8000-000000000001', 'Rhyncholaeliocattleya Memoria Helen Brown', '10000000-0000-4000-8000-000000000003', 'species', '20000000-0000-4000-8000-000000000001', 'species', '20000000-0000-4000-8000-000000000002', 'Demo registry import', 'Demo originator', '1967-01-01', 'RHS-DEMO-0001', '00000000-0000-4000-8000-000000000003', 'https://example.org/rhs-demo/memoria-helen-brown', 'approved', 'Demo grex for local development; replace with licensed registry import.'),
  ('30000000-0000-4000-8000-000000000002', 'Cattleya Circle of Life', '10000000-0000-4000-8000-000000000001', 'species', '20000000-0000-4000-8000-000000000001', 'species', '20000000-0000-4000-8000-000000000002', 'Demo registry import', 'Demo originator', '2001-01-01', 'RHS-DEMO-0002', '00000000-0000-4000-8000-000000000003', 'https://example.org/rhs-demo/circle-of-life', 'unreviewed', 'Demo pollen parent placeholder.'),
  ('30000000-0000-4000-8000-000000000003', 'Rhyncholaeliocattleya Hawaiian Passion', '10000000-0000-4000-8000-000000000003', 'grex', '30000000-0000-4000-8000-000000000001', 'grex', '30000000-0000-4000-8000-000000000002', 'Demo registry import', 'Demo originator', '2018-05-16', 'RHS-DEMO-0003', '00000000-0000-4000-8000-000000000003', 'https://example.org/rhs-demo/hawaiian-passion', 'unreviewed', 'Hybrid-first demo grex with recursive ancestry.')
on conflict (name) do update set verification = excluded.verification, notes = excluded.notes;

insert into cultivars (id, grex_id, cultivar_epithet, clone_name, source_id, source_url, evidence_notes, verification) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Sweet Afton', null, '00000000-0000-4000-8000-000000000004', 'https://example.org/award-demo/sweet-afton', 'Demo cultivar record; verify award evidence before public release.', 'doubtful')
on conflict (grex_id, cultivar_epithet, clone_name) do update set verification = excluded.verification, evidence_notes = excluded.evidence_notes;

insert into cultivar_awards (cultivar_id, award_body, award_code, award_date, score, source_url, evidence_notes) values
  ('40000000-0000-4000-8000-000000000001', 'AOS', 'HCC/AOS-DEMO', '2020-01-01', 78.00, 'https://example.org/award-demo/sweet-afton', 'Demo award evidence; not an authoritative award republication.');

insert into image_evidence (id, entity_kind, entity_id, storage_bucket, storage_path, source_url, source_id, license, license_status, photographer, rights_holder, access_date, view_type, quality_score, label_confidence, expert_verification, perceptual_hash, notes) values
  ('50000000-0000-4000-8000-000000000001', 'cultivar', '40000000-0000-4000-8000-000000000001', 'orchid-images', 'demo/sweet-afton-flower.jpg', 'https://example.org/images/sweet-afton-flower', '00000000-0000-4000-8000-000000000004', 'CC BY 4.0 demo placeholder', 'needs_review', 'Curator demo', 'Orchidarium demo', current_date, 'flower', 0.840, 0.780, 'doubtful', B'1010101010101010101010101010101010101010101010101010101010101010', 'Demo image evidence only; replace with permitted image assets.'),
  ('50000000-0000-4000-8000-000000000002', 'species', '20000000-0000-4000-8000-000000000001', 'orchid-images', 'demo/cattleya-dowiana-label.jpg', 'https://example.org/images/cattleya-dowiana-label', '00000000-0000-4000-8000-000000000002', 'Permitted demo placeholder', 'permitted', 'Nursery demo', 'Nursery demo', current_date, 'plant_label', 0.610, 0.880, 'approved', B'1111000011110000111100001111000011110000111100001111000011110000', 'Demo OCR label image evidence.');
