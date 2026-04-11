"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestOpenSettings } from "@/components/settings-open-bus";

/** /settings 直アクセス・ブックマーク用。モーダルを開きタイムラインへ戻す */
export default function SettingsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    requestOpenSettings();
    router.replace("/");
  }, [router]);

  return null;
}
