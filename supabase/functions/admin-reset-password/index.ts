// Supabase Edge Function: admin-reset-password
// ---------------------------------------------------------------------------
// Lets an ADMIN set another user's password directly, with NO email round-trip.
// This is the ONLY safe place to do it: the anon key the web app ships with
// cannot set other users' passwords, and the service_role key that CAN must
// never live in frontend code (it bypasses all RLS = full DB takeover if
// leaked). It lives here, server-side, injected automatically by Supabase.
//
// Security model (defense in depth — the function never trusts the browser):
//   1. verify_jwt (Supabase platform default) rejects any request without a
//      valid Supabase JWT before this code even runs.
//   2. We re-derive WHO is calling from that JWT (never from the request body)
//      and confirm their profile role carries the `user_management` permission.
//   3. A non-Developer caller cannot reset a Developer (hidden super-user)
//      account.
// Only after all three does the service_role client perform the reset.
//
// Deploy:  supabase functions deploy admin-reset-password
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided
//  automatically to every deployed function — no manual secret step needed.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // --- 1. Identify the caller from their JWT (not from the body) ---
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: callerErr,
    } = await callerClient.auth.getUser();
    if (callerErr || !caller) {
      return json({ error: "Not authenticated." }, 401);
    }

    // service_role client — bypasses RLS, used for the privileged reads/writes
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // --- 2. Confirm the caller has the user_management permission ---
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();
    if (!callerProfile) {
      return json({ error: "Caller profile not found." }, 403);
    }
    const { data: callerRole } = await admin
      .from("custom_roles")
      .select("permissions")
      .eq("name", callerProfile.role)
      .single();
    const callerPerms = (callerRole?.permissions ?? {}) as Record<string, boolean>;
    if (!callerPerms.user_management) {
      return json(
        { error: "Not authorized — requires User & Role Management permission." },
        403,
      );
    }

    // --- 3. Validate input ---
    const { userId, newPassword } = await req.json().catch(() => ({}));
    if (!userId || typeof newPassword !== "string" || newPassword.length < 6) {
      return json(
        { error: "userId and a newPassword of at least 6 characters are required." },
        400,
      );
    }

    // Protect the hidden Developer super-user: only a Developer may reset one.
    const { data: targetProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (
      targetProfile?.role === "Developer" &&
      callerProfile.role !== "Developer"
    ) {
      return json({ error: "You cannot reset this account's password." }, 403);
    }

    // --- 4. Perform the reset with the admin API ---
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (updErr) {
      return json({ error: updErr.message }, 400);
    }

    return json({ success: true }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
