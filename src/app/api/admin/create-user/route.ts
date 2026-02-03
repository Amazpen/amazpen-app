import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // Verify the requesting user is an admin
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
    }

    // Check if requesting user is admin
    const { data: profile } = await serverSupabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.is_admin) {
      return NextResponse.json({ error: "אין הרשאת אדמין" }, { status: 403 });
    }

    // Get request body
    const { email, password, fullName, phone, avatarUrl, businessId, role } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "חסרים אימייל או סיסמה" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "הסיסמה חייבת להכיל לפחות 6 תווים" }, { status: 400 });
    }

    // Create admin client with service role key
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "חסר הגדרות שרת" }, { status: 500 });
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Create user with admin API (skips email confirmation)
    const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name: fullName,
      },
    });

    if (createError) {
      console.error("Error creating user:", createError);
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }

    if (!newUser.user) {
      return NextResponse.json({ error: "לא הצלחנו ליצור משתמש" }, { status: 500 });
    }

    // Update profile with additional info
    const { error: profileError } = await adminSupabase
      .from("profiles")
      .update({
        full_name: fullName || null,
        phone: phone || null,
        avatar_url: avatarUrl || null,
      })
      .eq("id", newUser.user.id);

    if (profileError) {
      console.error("Error updating profile:", profileError);
      // Don't fail - profile will be created by trigger
    }

    // If businessId provided, create business_member record
    if (businessId) {
      const { error: memberError } = await adminSupabase
        .from("business_members")
        .insert({
          business_id: businessId,
          user_id: newUser.user.id,
          role: role || "employee",
          joined_at: new Date().toISOString(),
        });

      if (memberError) {
        console.error("Error creating business member:", memberError);
        // Don't fail - member can be added later
      }
    }

    return NextResponse.json({
      success: true,
      userId: newUser.user.id,
      email: newUser.user.email,
    });
  } catch (error) {
    console.error("Error in create-user:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "שגיאה בשרת" },
      { status: 500 }
    );
  }
}
