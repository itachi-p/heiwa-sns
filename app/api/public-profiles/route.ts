import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type PublicProfileRow = {
  id: string;
  nickname: string | null;
  avatar_url?: string | null;
  avatar_placeholder_hex?: string | null;
  public_id?: string | null;
};

export async function POST(req: Request) {
  let body: { userIds?: unknown };
  try {
    body = (await req.json()) as { userIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = Array.isArray(body.userIds) ? body.userIds : [];
  const userIds = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, 200);

  if (userIds.length === 0) {
    return NextResponse.json({ profiles: [] });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("users")
      .select("id, nickname, avatar_url, avatar_placeholder_hex, public_id")
      .in("id", userIds);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profiles: (data ?? []) as PublicProfileRow[] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
