import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createServiceClient(url, key);
}

// GET - fetch survey by token (public, no auth)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = getSupabaseAdmin();

  const { data: survey, error } = await supabase
    .from('customer_surveys')
    .select('id, is_completed, customer_id')
    .eq('token', token)
    .maybeSingle();

  if (error || !survey) {
    return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
  }

  // Get customer business name for display
  const { data: customer } = await supabase
    .from('customers')
    .select('business_name')
    .eq('id', survey.customer_id)
    .single();

  return NextResponse.json({
    id: survey.id,
    is_completed: survey.is_completed,
    business_name: customer?.business_name || '',
  });
}

// POST - submit survey responses (public, no auth)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = getSupabaseAdmin();

  const { data: survey } = await supabase
    .from('customer_surveys')
    .select('id, is_completed')
    .eq('token', token)
    .maybeSingle();

  if (!survey) {
    return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
  }

  if (survey.is_completed) {
    return NextResponse.json({ error: 'Survey already completed' }, { status: 400 });
  }

  const body = await request.json();
  const { responses } = body; // Array of { question_key, answer_value }

  if (!responses || !Array.isArray(responses)) {
    return NextResponse.json({ error: 'Missing responses array' }, { status: 400 });
  }

  // Insert responses
  const rows = responses.map((r: { question_key: string; answer_value: string }) => ({
    survey_id: survey.id,
    question_key: r.question_key,
    answer_value: String(r.answer_value),
  }));

  const { error: insertError } = await supabase
    .from('customer_survey_responses')
    .insert(rows);

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Mark survey as completed
  await supabase
    .from('customer_surveys')
    .update({ is_completed: true, completed_at: new Date().toISOString() })
    .eq('id', survey.id);

  return NextResponse.json({ success: true });
}
