import { createClient } from "@supabase/supabase-js";

/**
 * invite-flow E2E 用: 貸与「初回」状態へ戻す（成功・失敗の後に afterEach から呼ぶ）。
 *
 * 必要な環境変数: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
 * `E2E_LOGIN_EMAIL`, `E2E_LOGIN_PASSWORD`（Auth パスワードをこの値に戻す）。
 * 任意: `INVITE_CODE` … 消費済みなら未使用に戻す（同一トークンで次回を回す用）。
 *
 * 無効化: `E2E_LENT_TEARDOWN=0`
 */
export async function resetLentInviteUserAfterE2e(): Promise<void> {
  if ((process.env.E2E_LENT_TEARDOWN ?? "1").trim() === "0") {
    return;
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const email = (process.env.E2E_LOGIN_EMAIL ?? "").trim();
  const lentPassword = (process.env.E2E_LOGIN_PASSWORD ?? "").trim();

  if (!url || !serviceKey || !email || !lentPassword) {
    console.warn(
      "[e2e lent teardown] skip: need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2E_LOGIN_EMAIL, E2E_LOGIN_PASSWORD"
    );
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: row, error: selErr } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (selErr) {
    throw new Error(`[e2e lent teardown] users select: ${selErr.message}`);
  }
  if (!row?.id) {
    throw new Error(`[e2e lent teardown] no public.users row for email=${email}`);
  }

  const userId = row.id;

  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    password: lentPassword,
  });
  if (authErr) {
    throw new Error(`[e2e lent teardown] auth updateUserById: ${authErr.message}`);
  }

  const { error: upErr } = await admin
    .from("users")
    .update({
      invite_onboarding_completed: false,
      must_change_password: true,
      nickname: null,
      nickname_locked: false,
      invite_label: null,
    })
    .eq("id", userId);

  if (upErr) {
    throw new Error(`[e2e lent teardown] users update: ${upErr.message}`);
  }

  const token = (process.env.INVITE_CODE ?? "").trim();
  if (token) {
    const { error: tokErr } = await admin
      .from("invite_tokens")
      .update({
        is_used: false,
        used_at: null,
        used_by_user_id: null,
        used_by_email: null,
      })
      .eq("token", token);

    if (tokErr) {
      throw new Error(`[e2e lent teardown] invite_tokens update: ${tokErr.message}`);
    }
  }
}
