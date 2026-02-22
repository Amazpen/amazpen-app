import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'לא מחובר' }, { status: 401 });
    }

    // Check admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'אין הרשאת אדמין' }, { status: 403 });
    }

    const body = await request.json();
    const { daily_entry_id, fields } = body;

    if (!daily_entry_id || !fields || !Array.isArray(fields)) {
      return NextResponse.json(
        { error: 'Missing required fields: daily_entry_id, fields[]' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let approvedCount = 0;

    // Update each field approval
    for (const field of fields) {
      if (!field.field_name || !field.approve) continue;

      const { error } = await supabase
        .from('daily_entry_approvals')
        .update({
          status: 'approved',
          approved_by: user.id,
          approved_at: now,
        })
        .eq('daily_entry_id', daily_entry_id)
        .eq('field_name', field.field_name);

      if (!error) approvedCount++;
    }

    // Check if all fields are now approved
    const { data: pendingFields } = await supabase
      .from('daily_entry_approvals')
      .select('id')
      .eq('daily_entry_id', daily_entry_id)
      .eq('status', 'pending');

    if (!pendingFields || pendingFields.length === 0) {
      // All fields approved — mark entry as fully approved
      await supabase
        .from('daily_entries')
        .update({ is_fully_approved: true })
        .eq('id', daily_entry_id);
    }

    return NextResponse.json({
      approved_count: approvedCount,
      fully_approved: !pendingFields || pendingFields.length === 0,
    });
  } catch (error) {
    console.error('Error in approvals/daily-entry:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'שגיאה בשרת' },
      { status: 500 }
    );
  }
}
