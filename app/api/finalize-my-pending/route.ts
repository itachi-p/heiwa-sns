import { NextResponse } from "next/server";
import { finalizePendingPostsAndReplies } from "@/lib/server/finalize-pending-edits-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** ログインユーザー本人の pending のみ確定（ローカルでも cron なしで動かす用）。 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const result = await finalizePendingPostsAndReplies(admin, {
      filterUserId: user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "finalize failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
