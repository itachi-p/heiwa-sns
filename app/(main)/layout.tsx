"use client";

import { InviteOnboardingLayer } from "@/components/invite-onboarding-layer";
import { PublicIdRequiredLayer } from "@/components/public-id-required-layer";
import { MainBottomNav } from "@/components/main-bottom-nav";
import { SETTINGS_OPEN_EVENT } from "@/components/settings-open-bus";
import { ToxicitySettingsModal } from "@/components/toxicity-settings-modal";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function MainShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showNav, setShowNav] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const supabase = createClient();
  const router = useRouter();

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  useEffect(() => {
    const onOpen = () => openSettings();
    window.addEventListener(SETTINGS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SETTINGS_OPEN_EVENT, onOpen);
  }, [openSettings]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      setShowNav(!!session?.user);
    };
    void run();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      void run();
      // 自分のホームを見ている状態は URL が /@{自分のpublicId} になっている。
      // そのままログアウトすると URL が残り、別ユーザーでログインしても
      // 「前のユーザーの画面を見続けている」ように見える。それを防ぐため、
      // ログアウト時は常にタイムラインへ戻す。
      if (event === "SIGNED_OUT") {
        router.replace("/");
      }
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase, router]);

  return (
    <>
      <div className="pb-[calc(4.5rem+0.5rem+env(safe-area-inset-bottom,0px))]">
        {children}
      </div>
      <InviteOnboardingLayer />
      <PublicIdRequiredLayer />
      <ToxicitySettingsModal open={settingsOpen} onClose={closeSettings} />
      <MainBottomNav
        show={showNav}
        activityHasUnread={false}
        settingsOpen={settingsOpen}
        onOpenSettings={openSettings}
      />
    </>
  );
}
