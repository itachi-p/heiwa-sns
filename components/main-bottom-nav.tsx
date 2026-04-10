"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React from "react";
import { requestOpenCompose } from "@/components/compose-open-bus";

type NavProps = {
  /** ログイン済みでナビを出す */
  show: boolean;
  /** アクティビティに未読の可能性（軽量バッジ） */
  activityHasUnread?: boolean;
};

function TimelineIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={active ? "text-sky-600" : "text-gray-500"}
      aria-hidden
    >
      <path
        d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h11v2H4v-2z"
        fill="currentColor"
      />
    </svg>
  );
}

function ActivityIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={active ? "text-sky-600" : "text-gray-500"}
      aria-hidden
    >
      <path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M8.5 10.5h7M8.5 13.5h4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={active ? "text-sky-600" : "text-gray-500"}
      aria-hidden
    >
      <path
        d="M4 10.5 12 3l8 7.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={active ? "text-sky-600" : "text-gray-500"}
      aria-hidden
    >
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.61V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.61 1.7 1.7 0 0 0-1.87.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.61-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.61-1 1.7 1.7 0 0 0-.34-1.87l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.61V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.61 1.7 1.7 0 0 0 1.87-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05a1.7 1.7 0 0 0-.34 1.87V9c0 .69.41 1.3 1 1.61h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1 1.61z"
        stroke="currentColor"
        strokeWidth="0.9"
        fill="none"
        opacity="0.9"
      />
    </svg>
  );
}

export function MainBottomNav({ show, activityHasUnread }: NavProps) {
  const pathname = usePathname();
  const router = useRouter();

  if (!show) return null;

  const isTimeline = pathname === "/";
  const isActivity = pathname === "/home/activity" || pathname.startsWith("/home/activity");
  const isHome = pathname === "/home";
  const isSettings = pathname === "/settings";

  const navBtn =
    "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium text-gray-600 min-h-[52px] max-w-[20%]";

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[45] border-t border-gray-200/90 bg-white/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md"
      aria-label="メイン"
    >
      <div className="mx-auto flex max-w-lg items-end justify-between px-1 pt-1">
        <Link
          href="/"
          className={navBtn}
          title="タイムライン"
          aria-current={isTimeline ? "page" : undefined}
        >
          <TimelineIcon active={isTimeline} />
          <span className={isTimeline ? "text-sky-700" : ""}>TL</span>
        </Link>

        <Link
          href="/home/activity"
          className={navBtn}
          title="反応・アクティビティ"
          aria-current={isActivity ? "page" : undefined}
        >
          <span className="relative inline-flex">
            <ActivityIcon active={isActivity} />
            {activityHasUnread ? (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
            ) : null}
          </span>
          <span className={isActivity ? "text-sky-700" : ""}>反応</span>
        </Link>

        <button
          type="button"
          className="relative -mt-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-sky-600 text-2xl font-light text-white shadow-lg ring-4 ring-sky-50 hover:bg-sky-700"
          aria-label="投稿を書く"
          title="投稿"
          onClick={() => {
            if (pathname !== "/" && pathname !== "/home") {
              router.push("/");
              window.setTimeout(() => requestOpenCompose(), 80);
            } else {
              requestOpenCompose();
            }
          }}
        >
          +
        </button>

        <Link
          href="/home"
          className={navBtn}
          title="マイホーム"
          aria-current={isHome ? "page" : undefined}
        >
          <HomeIcon active={isHome} />
          <span className={isHome ? "text-sky-700" : ""}>ホーム</span>
        </Link>

        <Link
          href="/settings"
          className={navBtn}
          title="閲覧フィルタ"
          aria-current={isSettings ? "page" : undefined}
        >
          <SettingsIcon active={isSettings} />
          <span className={isSettings ? "text-sky-700" : ""}>設定</span>
        </Link>
      </div>
    </nav>
  );
}
