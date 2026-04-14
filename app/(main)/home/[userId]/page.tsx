"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim()
  );
}

/**
 * 旧 `/home/[uuid]` を公開IDのURLへ誘導する。
 */
export default function LegacyUserProfileRedirect() {
  const params = useParams();
  const router = useRouter();
  const raw = typeof params.userId === "string" ? params.userId : "";

  useEffect(() => {
    if (!raw.trim()) {
      router.replace("/");
      return;
    }
    if (!isUuid(raw)) {
      router.replace("/");
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("users")
        .select("public_id")
        .eq("id", raw.trim())
        .maybeSingle();
      if (cancelled) return;
      const pid =
        typeof data?.public_id === "string" ? data.public_id.trim() : "";
      if (pid) {
        router.replace(`/@${pid}`);
      } else {
        router.replace("/home");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [raw, router]);

  return (
    <main className="min-h-screen bg-sky-50 p-6">
      <p className="text-sm text-gray-600">移動中…</p>
    </main>
  );
}
