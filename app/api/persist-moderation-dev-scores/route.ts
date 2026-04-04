import { NextResponse } from "next/server";
import {
  mergeModerationDevScoresPatch,
  moderationDevScoresFromJsonb,
} from "@/lib/moderation-dev-scores-db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Body = {
  postId?: unknown;
  replyId?: unknown;
  patch?: {
    first?: Record<string, number>;
    second?: Record<string, number>;
  };
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const postId =
    typeof body.postId === "number" && Number.isFinite(body.postId)
      ? body.postId
      : null;
  const replyId =
    typeof body.replyId === "number" && Number.isFinite(body.replyId)
      ? body.replyId
      : null;
  if (
    (postId == null && replyId == null) ||
    (postId != null && replyId != null)
  ) {
    return NextResponse.json(
      { error: "specify exactly one of postId or replyId" },
      { status: 400 }
    );
  }

  const patch = body.patch;
  if (
    !patch ||
    typeof patch !== "object" ||
    (patch.first === undefined && patch.second === undefined)
  ) {
    return NextResponse.json({ error: "patch required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
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

  if (postId != null) {
    const { data: row, error: selErr } = await admin
      .from("posts")
      .select("user_id, moderation_dev_scores")
      .eq("id", postId)
      .maybeSingle();
    if (selErr) {
      return NextResponse.json({ error: selErr.message }, { status: 500 });
    }
    if (!row || row.user_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const base = moderationDevScoresFromJsonb(row.moderation_dev_scores);
    const next = mergeModerationDevScoresPatch(base, patch);
    const { error: updErr } = await admin
      .from("posts")
      .update({ moderation_dev_scores: next })
      .eq("id", postId);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const { data: rrow, error: rselErr } = await admin
    .from("post_replies")
    .select("user_id, moderation_dev_scores")
    .eq("id", replyId!)
    .maybeSingle();
  if (rselErr) {
    return NextResponse.json({ error: rselErr.message }, { status: 500 });
  }
  if (!rrow || rrow.user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rbase = moderationDevScoresFromJsonb(rrow.moderation_dev_scores);
  const rnext = mergeModerationDevScoresPatch(rbase, patch);
  const { error: rupdErr } = await admin
    .from("post_replies")
    .update({ moderation_dev_scores: rnext })
    .eq("id", replyId!);
  if (rupdErr) {
    return NextResponse.json({ error: rupdErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
