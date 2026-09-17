-- Orchidarium hybrid-first intelligence schema for Supabase Postgres.
-- Requires Supabase extensions: pgvector, pg_trgm, unaccent, pgcrypto.

create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists pgcrypto;

create type orchid_entity_kind as enum ('species', 'grex', 'cultivar');
create type parent_role as enum ('seed', 'pollen');
create type image_view_type as enum ('flower', 'whole_plant', 'plant_label', 'habitat', 'award_photo', 'unknown');
create type verification_status as enum ('unreviewed', 'approved', 'rejected', 'doubtful');
create type license_status as enum ('unknown', 'permitted', 'restricted', 'public_domain', 'creative_commons', 'needs_review');
create type identification_provider as enum ('plantnet', 'plant_id', 'internal_vector', 'curator');

create table sources (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  url text,
  license text,
  notes text,
  accessed_at date default current_date,
  created_at timestamptz not null default now()
);

create table genera (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  standard_abbreviation text,
  source_id uuid references sources(id),
  created_at timestamptz not null default now()
);

create table species (
  id uuid primary key default gen_random_uuid(),
  genus_id uuid not null references genera(id),
  genus_name text not null,
  specific_epithet text not null,
  infraspecific_rank text,
  infraspecific_epithet text,
  full_name text generated always as (
    trim(genus_name || ' ' || specific_epithet || coalesce(' ' || infraspecific_rank || ' ' || infraspecific_epithet, ''))
  ) stored,
  authorship text,
  accepted_name_id uuid references species(id),
  powo_id text unique,
  gbif_taxon_key bigint,
  wcvp_id text,
  distribution text[],
  conservation_status text,
  source_id uuid references sources(id),
  search_document tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(genus_name, specific_epithet, infraspecific_rank, infraspecific_epithet)
);

create table species_synonyms (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  synonym text not null,
  source_id uuid references sources(id),
  unique(species_id, synonym)
);

create table grexes (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  genus_id uuid references genera(id),
  seed_parent_kind orchid_entity_kind not null,
  seed_parent_id uuid not null,
  pollen_parent_kind orchid_entity_kind not null,
  pollen_parent_id uuid not null,
  registrant text,
  originator text,
  registration_date date,
  rhs_registration_number text,
  source_id uuid references sources(id),
  source_url text,
  notes text,
  verification verification_status not null default 'unreviewed',
  search_document tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grex_seed_parent_species_or_grex check (seed_parent_kind in ('species', 'grex')),
  constraint grex_pollen_parent_species_or_grex check (pollen_parent_kind in ('species', 'grex'))
);

create table cultivars (
  id uuid primary key default gen_random_uuid(),
  grex_id uuid not null references grexes(id) on delete cascade,
  cultivar_epithet text not null,
  clone_name text,
  display_name text generated always as (cultivar_epithet || coalesce(' (' || clone_name || ')', '')) stored,
  source_id uuid references sources(id),
  source_url text,
  evidence_notes text,
  verification verification_status not null default 'unreviewed',
  search_document tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(grex_id, cultivar_epithet, clone_name)
);

create table cultivar_awards (
  id uuid primary key default gen_random_uuid(),
  cultivar_id uuid not null references cultivars(id) on delete cascade,
  award_body text not null,
  award_code text not null,
  award_date date,
  score numeric(5,2),
  source_url text,
  evidence_notes text
);

create table image_evidence (
  id uuid primary key default gen_random_uuid(),
  entity_kind orchid_entity_kind not null,
  entity_id uuid,
  storage_bucket text not null default 'orchid-images',
  storage_path text,
  source_url text,
  source_id uuid references sources(id),
  license text,
  license_status license_status not null default 'needs_review',
  photographer text,
  rights_holder text,
  access_date date not null default current_date,
  view_type image_view_type not null default 'unknown',
  quality_score numeric(4,3) check (quality_score between 0 and 1),
  label_confidence numeric(4,3) check (label_confidence between 0 and 1),
  expert_verification verification_status not null default 'unreviewed',
  perceptual_hash bit(64),
  embedding vector(1536),
  notes text,
  created_at timestamptz not null default now(),
  constraint image_rights_required check (source_url is not null or storage_path is not null),
  constraint image_license_trace_required check (license is not null and access_date is not null)
);

create table label_ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  image_id uuid references image_evidence(id) on delete cascade,
  raw_text text,
  normalized_text text,
  confidence numeric(4,3),
  candidate_entity_kind orchid_entity_kind,
  candidate_entity_id uuid,
  status verification_status not null default 'unreviewed',
  created_at timestamptz not null default now()
);

create table identification_runs (
  id uuid primary key default gen_random_uuid(),
  upload_image_id uuid references image_evidence(id),
  query_embedding vector(1536),
  label_text text,
  explanation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table identification_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references identification_runs(id) on delete cascade,
  provider identification_provider not null,
  entity_kind orchid_entity_kind not null,
  entity_id uuid,
  provider_label text,
  raw_score numeric(6,5),
  vector_distance numeric(8,6),
  parentage_boost numeric(6,5) not null default 0,
  final_probability numeric(6,5),
  explanation text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table curation_events (
  id uuid primary key default gen_random_uuid(),
  curator_id uuid references auth.users(id),
  action text not null,
  target_table text not null,
  target_id uuid not null,
  previous_value jsonb,
  new_value jsonb,
  notes text,
  created_at timestamptz not null default now()
);


create or replace function set_species_search_document()
returns trigger
language plpgsql as $$
begin
  new.search_document :=
    setweight(to_tsvector('simple', unaccent(coalesce(new.genus_name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.specific_epithet, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.authorship, ''))), 'C');
  new.updated_at := now();
  return new;
end;
$$;

create trigger species_search_document_before_write
before insert or update on species
for each row execute function set_species_search_document();

create or replace function set_grex_search_document()
returns trigger
language plpgsql as $$
begin
  new.search_document :=
    setweight(to_tsvector('simple', unaccent(coalesce(new.name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.registrant, ''))), 'C') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.originator, ''))), 'C') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.rhs_registration_number, ''))), 'B');
  new.updated_at := now();
  return new;
end;
$$;

create trigger grexes_search_document_before_write
before insert or update on grexes
for each row execute function set_grex_search_document();

create or replace function set_cultivar_search_document()
returns trigger
language plpgsql as $$
begin
  new.search_document :=
    setweight(to_tsvector('simple', unaccent(coalesce(new.cultivar_epithet, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.clone_name, ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.evidence_notes, ''))), 'D');
  new.updated_at := now();
  return new;
end;
$$;

create trigger cultivars_search_document_before_write
before insert or update on cultivars
for each row execute function set_cultivar_search_document();

create or replace function orchid_entity_exists(p_kind orchid_entity_kind, p_id uuid)
returns boolean
language plpgsql stable as $$
begin
  if p_kind = 'species' then
    return exists (select 1 from species where id = p_id);
  elsif p_kind = 'grex' then
    return exists (select 1 from grexes where id = p_id);
  elsif p_kind = 'cultivar' then
    return exists (select 1 from cultivars where id = p_id);
  end if;
  return false;
end;
$$;

create or replace function validate_grex_parents()
returns trigger
language plpgsql as $$
begin
  if new.seed_parent_kind = 'cultivar' or new.pollen_parent_kind = 'cultivar' then
    raise exception 'Grex parents must be species or registered grexes, not cultivars';
  end if;
  if not orchid_entity_exists(new.seed_parent_kind, new.seed_parent_id) then
    raise exception 'Seed parent % % does not exist', new.seed_parent_kind, new.seed_parent_id;
  end if;
  if not orchid_entity_exists(new.pollen_parent_kind, new.pollen_parent_id) then
    raise exception 'Pollen parent % % does not exist', new.pollen_parent_kind, new.pollen_parent_id;
  end if;
  if new.seed_parent_kind = 'grex' and new.seed_parent_id = new.id then
    raise exception 'A grex cannot be its own seed parent';
  end if;
  if new.pollen_parent_kind = 'grex' and new.pollen_parent_id = new.id then
    raise exception 'A grex cannot be its own pollen parent';
  end if;
  return new;
end;
$$;

create trigger grexes_validate_parents_before_write
before insert or update on grexes
for each row execute function validate_grex_parents();

create or replace function validate_image_entity()
returns trigger
language plpgsql as $$
begin
  if new.entity_id is not null and not orchid_entity_exists(new.entity_kind, new.entity_id) then
    raise exception 'Image entity % % does not exist', new.entity_kind, new.entity_id;
  end if;
  return new;
end;
$$;

create trigger image_evidence_validate_entity_before_write
before insert or update on image_evidence
for each row execute function validate_image_entity();

create index species_search_idx on species using gin(search_document);
create index species_full_name_trgm_idx on species using gin(full_name gin_trgm_ops);
create index species_synonyms_trgm_idx on species_synonyms using gin(synonym gin_trgm_ops);
create index grexes_search_idx on grexes using gin(search_document);
create index grexes_name_trgm_idx on grexes using gin(name gin_trgm_ops);
create index cultivars_search_idx on cultivars using gin(search_document);
create index cultivars_epithet_trgm_idx on cultivars using gin(cultivar_epithet gin_trgm_ops);
create index image_evidence_embedding_idx on image_evidence using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function orchid_search(q text, max_results int default 25)
returns table(entity_kind orchid_entity_kind, entity_id uuid, label text, rank_score real, match_reason text)
language sql stable as $$
  with query as (select websearch_to_tsquery('simple', unaccent(q)) tsq, unaccent(q) uq)
  select 'species'::orchid_entity_kind, s.id, s.full_name,
    greatest(ts_rank(s.search_document, query.tsq), similarity(unaccent(s.full_name), query.uq))::real,
    'species/name'
  from species s, query
  where s.search_document @@ query.tsq or unaccent(s.full_name) % query.uq
  union all
  select 'species', sy.species_id, sy.synonym,
    similarity(unaccent(sy.synonym), query.uq)::real,
    'species/synonym'
  from species_synonyms sy, query
  where unaccent(sy.synonym) % query.uq
  union all
  select 'grex', g.id, g.name,
    greatest(ts_rank(g.search_document, query.tsq), similarity(unaccent(g.name), query.uq))::real,
    'registered grex'
  from grexes g, query
  where g.search_document @@ query.tsq or unaccent(g.name) % query.uq
  union all
  select 'cultivar', c.id, c.display_name,
    greatest(ts_rank(c.search_document, query.tsq), similarity(unaccent(c.display_name), query.uq))::real,
    'cultivar/clone'
  from cultivars c, query
  where c.search_document @@ query.tsq or unaccent(c.display_name) % query.uq
  order by rank_score desc
  limit max_results;
$$;

create or replace function grex_ancestry(root_grex uuid, max_depth int default 8)
returns table(descendant_grex_id uuid, ancestor_kind orchid_entity_kind, ancestor_id uuid, depth int, path uuid[])
language sql stable as $$
  with recursive walk(descendant_grex_id, ancestor_kind, ancestor_id, depth, path) as (
    select g.id, g.seed_parent_kind, g.seed_parent_id, 1, array[g.id]
    from grexes g where g.id = root_grex
    union all
    select g.id, g.pollen_parent_kind, g.pollen_parent_id, 1, array[g.id]
    from grexes g where g.id = root_grex
    union all
    select walk.descendant_grex_id, g.seed_parent_kind, g.seed_parent_id, walk.depth + 1, path || g.id
    from walk join grexes g on walk.ancestor_kind = 'grex' and walk.ancestor_id = g.id
    where walk.depth < max_depth and not g.id = any(path)
    union all
    select walk.descendant_grex_id, g.pollen_parent_kind, g.pollen_parent_id, walk.depth + 1, path || g.id
    from walk join grexes g on walk.ancestor_kind = 'grex' and walk.ancestor_id = g.id
    where walk.depth < max_depth and not g.id = any(path)
  ) select * from walk;
$$;

create or replace function grex_genetic_contribution(root_grex uuid, max_depth int default 8)
returns table(ancestor_kind orchid_entity_kind, ancestor_id uuid, contribution numeric)
language sql stable as $$
  with recursive walk(ancestor_kind, ancestor_id, depth, contribution, path) as (
    select g.seed_parent_kind, g.seed_parent_id, 1, 0.5::numeric, array[g.id]
    from grexes g where g.id = root_grex
    union all
    select g.pollen_parent_kind, g.pollen_parent_id, 1, 0.5::numeric, array[g.id]
    from grexes g where g.id = root_grex
    union all
    select g.seed_parent_kind, g.seed_parent_id, walk.depth + 1, walk.contribution / 2, path || g.id
    from walk join grexes g on walk.ancestor_kind = 'grex' and walk.ancestor_id = g.id
    where walk.depth < max_depth and not g.id = any(path)
    union all
    select g.pollen_parent_kind, g.pollen_parent_id, walk.depth + 1, walk.contribution / 2, path || g.id
    from walk join grexes g on walk.ancestor_kind = 'grex' and walk.ancestor_id = g.id
    where walk.depth < max_depth and not g.id = any(path)
  ) select ancestor_kind, ancestor_id, sum(contribution) from walk group by 1,2 order by 3 desc;
$$;

create or replace function match_image_embedding(query_embedding vector(1536), match_count int default 20)
returns table(image_id uuid, entity_kind orchid_entity_kind, entity_id uuid, distance float, similarity float)
language sql stable as $$
  select id, entity_kind, entity_id,
    embedding <=> query_embedding as distance,
    1 - (embedding <=> query_embedding) as similarity
  from image_evidence
  where embedding is not null and expert_verification <> 'rejected' and license_status <> 'restricted'
  order by embedding <=> query_embedding
  limit match_count;
$$;

create or replace function rerank_identification_candidates(p_run_id uuid)
returns setof identification_candidates
language plpgsql as $$
begin
  update identification_candidates c
  set final_probability = least(0.99999, greatest(0.00001,
    coalesce(raw_score, 0) * 0.55 + coalesce(1 - vector_distance, 0) * 0.35 + coalesce(parentage_boost, 0) * 0.10
  )),
  explanation = concat_ws(' ', explanation, 'Probability combines provider confidence, internal visual similarity, and parentage context; it is not an absolute identification.')
  where c.run_id = p_run_id;
  return query select * from identification_candidates where run_id = p_run_id order by final_probability desc nulls last;
end;
$$;

alter table sources enable row level security;
alter table genera enable row level security;
alter table species enable row level security;
alter table species_synonyms enable row level security;
alter table grexes enable row level security;
alter table cultivars enable row level security;
alter table cultivar_awards enable row level security;
alter table image_evidence enable row level security;
alter table label_ocr_jobs enable row level security;
alter table identification_runs enable row level security;
alter table identification_candidates enable row level security;
alter table curation_events enable row level security;

create policy "public read reference data" on sources for select using (true);
create policy "public read genera" on genera for select using (true);
create policy "public read species" on species for select using (true);
create policy "public read synonyms" on species_synonyms for select using (true);
create policy "public read grexes" on grexes for select using (true);
create policy "public read cultivars" on cultivars for select using (true);
create policy "public read awards" on cultivar_awards for select using (true);
create policy "public read approved images" on image_evidence for select using (expert_verification = 'approved' and license_status <> 'restricted');
