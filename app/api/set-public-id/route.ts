import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isValidPublicIdFormat,
  normalizePublicId,
  publicIdValidationMessage,
} from "@/lib/public-id";

export async function POST(req: Request) {
  let body: { publicId?: string };
  try {
    body = (await req.json()) as { publicId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = typeof body.publicId === "string" ? body.publicId : "";
  const publicId = normalizePublicId(raw);
  if (!isValidPublicIdFormat(publicId)) {
    return NextResponse.json(
      { error: publicIdValidationMessage() },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: row, error: selErr } = await supabase
    .from("users")
    .select("public_id")
    .eq("id", user.id)
    .maybeSingle();

  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (row?.public_id != null && String(row.public_id).trim() !== "") {
    return NextResponse.json(
      { error: "公開IDは既に設定済みです。" },
      { status: 409 }
    );
  }

  const { error: upErr } = await supabase
    .from("users")
    .update({ public_id: publicId })
    .eq("id", user.id)
    .is("public_id", null);

  if (upErr) {
    const msg = upErr.message ?? "";
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json(
        { error: "このIDは既に使われています。" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, publicId });
}
