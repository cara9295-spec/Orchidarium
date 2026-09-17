import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type IdentifyRequest = {
  storagePath?: string;
  sourceUrl?: string;
  license: string;
  photographer?: string;
  rightsHolder?: string;
  accessDate?: string;
  embedding?: number[];
  labelText?: string;
  providerResults?: Array<{ provider: 'plantnet' | 'plant_id'; label: string; score: number; payload?: Record<string, unknown> }>;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const payload = (await req.json()) as IdentifyRequest;
  if (!payload.license) return Response.json({ error: 'license is required for every image' }, { status: 400, headers: corsHeaders });
  if (!payload.storagePath && !payload.sourceUrl) return Response.json({ error: 'storagePath or sourceUrl is required' }, { status: 400, headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  const { data: image, error: imageError } = await supabase.from('image_evidence').insert({
    entity_kind: 'species',
    storage_path: payload.storagePath ?? null,
    source_url: payload.sourceUrl ?? null,
    license: payload.license,
    photographer: payload.photographer ?? null,
    rights_holder: payload.rightsHolder ?? null,
    access_date: payload.accessDate ?? new Date().toISOString().slice(0, 10),
    view_type: 'unknown',
    expert_verification: 'unreviewed',
    embedding: payload.embedding ?? null,
  }).select().single();
  if (imageError) return Response.json({ error: imageError.message }, { status: 500, headers: corsHeaders });

  const { data: run, error: runError } = await supabase.from('identification_runs').insert({
    upload_image_id: image.id,
    query_embedding: payload.embedding ?? null,
    label_text: payload.labelText ?? null,
    explanation: { probabilistic: true, note: 'Candidates are hypotheses requiring evidence and, when possible, expert review.' },
  }).select().single();
  if (runError) return Response.json({ error: runError.message }, { status: 500, headers: corsHeaders });

  const rows = [];
  for (const result of payload.providerResults ?? []) {
    const { data: matches } = await supabase.rpc('orchid_search', { q: result.label, max_results: 1 });
    const match = Array.isArray(matches) ? matches[0] : undefined;
    rows.push({
      run_id: run.id,
      provider: result.provider,
      entity_kind: match?.entity_kind ?? 'species',
      entity_id: match?.entity_id ?? null,
      provider_label: result.label,
      raw_score: result.score,
      payload: result.payload ?? {},
      explanation: `${result.provider} suggested ${result.label}; mapped to Orchidarium evidence when possible.`,
    });
  }

  if (payload.embedding) {
    const { data: vectorMatches } = await supabase.rpc('match_image_embedding', { query_embedding: payload.embedding, match_count: 10 });
    for (const match of vectorMatches ?? []) {
      rows.push({
        run_id: run.id,
        provider: 'internal_vector',
        entity_kind: match.entity_kind,
        entity_id: match.entity_id,
        provider_label: 'Internal visual neighbor',
        raw_score: match.similarity,
        vector_distance: match.distance,
        explanation: 'Internal pgvector similarity candidate from licensed or approved evidence.',
      });
    }
  }

  if (rows.length) await supabase.from('identification_candidates').insert(rows);
  const { data: candidates, error } = await supabase.rpc('rerank_identification_candidates', { run: run.id });
  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

  return Response.json({ run, image, candidates }, { headers: corsHeaders });
});
