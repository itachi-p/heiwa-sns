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
  /** 閲覧フィルタモーダルが開いている */
  settingsOpen?: boolean;
  /** 設定ボタン押下（モーダルを開く） */
  onOpenSettings?: () => void;
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
        d="M4 6.5a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H11l-3.5 3v-3H6.5A2.5 2.5 0 0 1 4 13.5v-7z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M8 8.75h8M8 11.75h5"
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

/** 投稿の見え方（閲覧フィルタ）用 */
function VisibilityFilterIcon({ active }: { active: boolean }) {
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
        d="M1 12s4.5-7 11-7 11 7 11 7-4.5 7-11 7S1 12 1 12Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <circle
        cx="12"
        cy="12"
        r="3.25"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}

export function MainBottomNav({
  show,
  activityHasUnread,
  settingsOpen = false,
  onOpenSettings,
}: NavProps) {
  const pathname = usePathname();
  const router = useRouter();

  if (!show) return null;

  const isTimeline = pathname === "/";
  const isActivity = pathname === "/home/activity" || pathname.startsWith("/home/activity");
  const isHome = pathname === "/home";

  const navBtn =
    "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium text-gray-600 min-h-[52px] max-w-[20%]";

  return (
    <nav
      className="fixed bottom-2 left-0 right-0 z-[45] border-t border-gray-200/90 bg-white/95 pb-[max(0.375rem,env(safe-area-inset-bottom,0px))] pt-1 backdrop-blur-md"
      aria-label="メイン"
    >
      <div className="mx-auto flex max-w-lg items-end justify-between px-1">
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
          title="リプ・アクティビティ"
          aria-current={isActivity ? "page" : undefined}
        >
          <span className="relative inline-flex">
            <ActivityIcon active={isActivity} />
            {activityHasUnread ? (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
            ) : null}
          </span>
          <span className={isActivity ? "text-sky-700" : ""}>リプ</span>
        </Link>

        <button
          type="button"
          className="relative -mt-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xl font-light leading-none text-white shadow-md ring-2 ring-sky-100 hover:bg-sky-700"
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

        <button
          type="button"
          className={navBtn}
          title="可視性（閲覧フィルタ）"
          aria-expanded={settingsOpen}
          onClick={() => onOpenSettings?.()}
        >
          <VisibilityFilterIcon active={settingsOpen} />
          <span className={settingsOpen ? "text-sky-700" : ""}>可視性</span>
        </button>
      </div>
    </nav>
  );
}
