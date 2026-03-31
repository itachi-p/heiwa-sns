import { NextResponse } from "next/server";
import { scoreTextOverallMax } from "@/lib/server/moderation";
import { POST_EDIT_WINDOW_MS } from "@/lib/post-edit-window";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - POST_EDIT_WINDOW_MS).toISOString();

  const { data: posts, error: postsError } = await admin
    .from("posts")
    .select("id, pending_content")
    .lte("created_at", cutoff)
    .not("pending_content", "is", null);
  if (postsError) {
    return NextResponse.json({ error: postsError.message }, { status: 500 });
  }

  for (const p of posts ?? []) {
    const next = String(p.pending_content ?? "").trim();
    if (!next) {
      await admin.from("posts").update({ pending_content: null }).eq("id", p.id);
      continue;
    }
    const score = await scoreTextOverallMax(next, "perspective");
    await admin
      .from("posts")
      .update({
        content: next,
        moderation_max_score: score,
        pending_content: null,
      })
      .eq("id", p.id);
  }

  const { data: replies, error: repliesError } = await admin
    .from("post_replies")
    .select("id, pending_content")
    .lte("created_at", cutoff)
    .not("pending_content", "is", null);
  if (repliesError) {
    return NextResponse.json({ error: repliesError.message }, { status: 500 });
  }

  for (const r of replies ?? []) {
    const next = String(r.pending_content ?? "").trim();
    if (!next) {
      await admin.from("post_replies").update({ pending_content: null }).eq("id", r.id);
      continue;
    }
    await admin
      .from("post_replies")
      .update({
        content: next,
        pending_content: null,
      })
      .eq("id", r.id);
  }

  return NextResponse.json({
    ok: true,
    finalizedPosts: posts?.length ?? 0,
    finalizedReplies: replies?.length ?? 0,
  });
}
