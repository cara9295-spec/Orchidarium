import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type OcrRequest = {
  imageId: string;
  imageUrl?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const body = (await req.json()) as OcrRequest;
  if (!body.imageId) return Response.json({ error: 'imageId is required' }, { status: 400, headers: corsHeaders });

  const endpoint = Deno.env.get('OCR_ENDPOINT');
  let rawText = '';
  let confidence = 0;

  if (endpoint && body.imageUrl) {
    const ocrResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${Deno.env.get('OCR_API_KEY') ?? ''}` },
      body: JSON.stringify({ image_url: body.imageUrl }),
    });
    const payload = await ocrResponse.json();
    rawText = String(payload.text ?? '');
    confidence = Number(payload.confidence ?? 0);
  }

  const normalizedText = rawText.replace(/\s+/g, ' ').trim();
  const { data: matches } = await supabase.rpc('orchid_search', { q: normalizedText, max_results: 5 });
  const top = Array.isArray(matches) ? matches[0] : undefined;

  const { data, error } = await supabase.from('label_ocr_jobs').insert({
    image_id: body.imageId,
    raw_text: rawText,
    normalized_text: normalizedText,
    confidence,
    candidate_entity_kind: top?.entity_kind ?? null,
    candidate_entity_id: top?.entity_id ?? null,
  }).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  return Response.json({ job: data, candidates: matches ?? [] }, { headers: corsHeaders });
});
