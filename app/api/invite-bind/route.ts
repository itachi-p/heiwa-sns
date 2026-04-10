import { NextResponse } from "next/server";
import { generateInviteLabel } from "@/lib/invite-label";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Body = { inviteToken?: unknown };

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/** ログイン済みユーザーが招待コードを消費する（Google OAuth 初回など） */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest("invalid json");
  }

  const inviteToken =
    typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
  if (!inviteToken) {
    return badRequest("inviteToken is required");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "server misconfigured (service role)" },
      { status: 503 }
    );
  }

  const { data: row, error: fetchErr } = await admin
    .from("users")
    .select("invite_onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (row?.invite_onboarding_completed) {
    return badRequest("すでに招待コードは登録済みです。");
  }

  const { data: tokenRow, error: tokenErr } = await admin
    .from("invite_tokens")
    .select("id, is_used")
    .eq("token", inviteToken)
    .maybeSingle();

  if (tokenErr) {
    return NextResponse.json({ error: tokenErr.message }, { status: 500 });
  }
  if (!tokenRow || tokenRow.is_used) {
    return badRequest("招待コードが無効です。");
  }

  const { data: consumed, error: consumeErr } = await admin
    .from("invite_tokens")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
      used_by_user_id: user.id,
      used_by_email: user.email ?? "",
    })
    .eq("id", tokenRow.id)
    .eq("is_used", false)
    .select("id")
    .maybeSingle();

  if (consumeErr || !consumed) {
    return badRequest("招待コードが無効です。");
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const inviteLabel = generateInviteLabel();
    const { error: profileErr } = await admin
      .from("users")
      .update({
        is_invite_user: true,
        invite_onboarding_completed: true,
        invite_label: inviteLabel,
      })
      .eq("id", user.id);

    if (!profileErr) {
      return NextResponse.json({ ok: true });
    }
    const code = (profileErr as { code?: string }).code;
    const msg = (profileErr.message ?? "").toLowerCase();
    if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
      continue;
    }
    return NextResponse.json(
      { error: profileErr.message ?? "プロフィールの更新に失敗しました。" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: "招待ラベルの採番に失敗しました。もう一度お試しください。" },
    { status: 500 }
  );
}
