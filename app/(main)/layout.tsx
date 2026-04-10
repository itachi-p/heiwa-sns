"use client";

import { InviteOnboardingLayer } from "@/components/invite-onboarding-layer";
import { MainBottomNav } from "@/components/main-bottom-nav";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

export default function MainShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showNav, setShowNav] = useState(false);
  const supabase = createClient();

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
    } = supabase.auth.onAuthStateChange(() => {
      void run();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  return (
    <>
      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
        {children}
      </div>
      <InviteOnboardingLayer />
      <MainBottomNav show={showNav} activityHasUnread={false} />
    </>
  );
}
