import { NextResponse } from "next/server";
import { generateInviteLabel } from "@/lib/invite-label";
import { createAdminClient } from "@/lib/supabase/admin";

type Body = {
  email?: unknown;
  password?: unknown;
  inviteToken?: unknown;
};

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest("invalid json");
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const inviteToken =
    typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";

  if (!email || !password || !inviteToken) {
    return badRequest("email, password, inviteToken are required");
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

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  });
  if (createErr || !created.user?.id) {
    return badRequest(createErr?.message ?? "新規登録に失敗しました。");
  }

  const { data: consumed, error: consumeErr } = await admin
    .from("invite_tokens")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
      used_by_user_id: created.user.id,
      used_by_email: email,
    })
    .eq("id", tokenRow.id)
    .eq("is_used", false)
    .select("id")
    .maybeSingle();

  if (consumeErr || !consumed) {
    // race 等でトークン消費に失敗した場合は作成ユーザーを戻す
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {
      /* best effort */
    });
    return badRequest("招待コードが無効です。");
  }

  const uid = created.user.id;
  for (let attempt = 0; attempt < 10; attempt++) {
    const inviteLabel = generateInviteLabel();
    const { error: profileErr } = await admin
      .from("users")
      .update({
        is_invite_user: true,
        must_change_password: false,
        invite_label: inviteLabel,
      })
      .eq("id", uid);
    if (!profileErr) {
      return NextResponse.json({ ok: true });
    }
    const code = (profileErr as { code?: string }).code;
    const msg = (profileErr.message ?? "").toLowerCase();
    if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
      continue;
    }
    await admin.auth.admin.deleteUser(uid).catch(() => {
      /* best effort */
    });
    return NextResponse.json(
      { error: profileErr.message ?? "プロフィールの更新に失敗しました。" },
      { status: 500 }
    );
  }

  await admin.auth.admin.deleteUser(uid).catch(() => {
    /* best effort */
  });
  return NextResponse.json(
    { error: "招待ラベルの採番に失敗しました。もう一度お試しください。" },
    { status: 500 }
  );
}
