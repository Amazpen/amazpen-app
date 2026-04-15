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

    const body = await request.json();
    const { payment_id } = body;

    if (!payment_id) {
      return NextResponse.json(
        { error: 'Missing required field: payment_id' },
        { status: 400 }
      );
    }

    // Check authorization: system admin OR business admin/owner for this payment's business
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    let authorized = profile?.is_admin === true;

    if (!authorized) {
      const { data: paymentRow } = await supabase
        .from('payments')
        .select('business_id')
        .eq('id', payment_id)
        .maybeSingle();

      if (paymentRow?.business_id) {
        const { data: membership } = await supabase
          .from('business_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('business_id', paymentRow.business_id)
          .is('deleted_at', null)
          .maybeSingle();

        if (membership?.role === 'admin' || membership?.role === 'owner') {
          authorized = true;
        }
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'אין הרשאה לאישור תשלומים' }, { status: 403 });
    }

    const now = new Date().toISOString();

    const { error } = await supabase
      .from('payments')
      .update({
        approval_status: 'approved',
        review_approved_by: user.id,
        review_approved_at: now,
      })
      .eq('id', payment_id);

    if (error) {
      console.error('Error approving payment:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, payment_id });
  } catch (error) {
    console.error('Error in approvals/payment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'שגיאה בשרת' },
      { status: 500 }
    );
  }
}
