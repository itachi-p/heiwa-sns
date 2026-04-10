"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { SiteHeader } from "@/components/site-header";
import { createClient } from "@/lib/supabase/client";
import {
  fetchToxicityFilterLevel,
  fetchToxicityOverThresholdBehavior,
} from "@/lib/timeline-threshold";
import {
  TOXICITY_FILTER_LEVEL_LABELS,
  TOXICITY_FILTER_SELECT_ORDER,
  type ToxicityFilterLevel,
  type ToxicityOverThresholdBehavior,
} from "@/lib/toxicity-filter-level";

const supabase = createClient();

const LEVELS = TOXICITY_FILTER_SELECT_ORDER;

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profilePlaceholderHex, setProfilePlaceholderHex] = useState<
    string | null
  >(null);
  const [level, setLevel] = useState<ToxicityFilterLevel>("normal");
  const [behavior, setBehavior] =
    useState<ToxicityOverThresholdBehavior>("hide");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const uid = user?.id ?? null;

  useEffect(() => {
    if (!uid) return;
    void (async () => {
      const { data } = await supabase
        .from("users")
        .select("nickname, avatar_url, avatar_placeholder_hex")
        .eq("id", uid)
        .maybeSingle();
      setProfileNickname(data?.nickname ?? null);
      setProfileAvatarUrl(data?.avatar_url ?? null);
      setProfilePlaceholderHex(
        (data as { avatar_placeholder_hex?: string | null } | null)
          ?.avatar_placeholder_hex ?? null
      );
      setLevel(await fetchToxicityFilterLevel(supabase, uid));
      setBehavior(await fetchToxicityOverThresholdBehavior(supabase, uid));
    })();
  }, [uid]);

  const levelIndex = LEVELS.indexOf(level);
  const setLevelIndex = (i: number) => {
    const next = LEVELS[Math.max(0, Math.min(3, i))];
    if (next) setLevel(next);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const save = async () => {
    if (!uid) return;
    setSaving(true);
    setToast(null);
    const { error } = await supabase
      .from("users")
      .update({
        toxicity_filter_level: level,
        toxicity_over_threshold_behavior: behavior,
      })
      .eq("id", uid);
    setSaving(false);
    if (error) {
      setToast(error.message);
      return;
    }
    setToast("保存しました");
    window.setTimeout(() => setToast(null), 2500);
  };

  return (
    <main className="min-h-screen bg-sky-50 text-gray-900">
      <SiteHeader
        authReady={authReady}
        user={user}
        profileNickname={profileNickname}
        profileAvatarUrl={profileAvatarUrl}
        avatarPlaceholderHex={profilePlaceholderHex}
        onSignOut={signOut}
      />
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Link
            href="/home"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50"
          >
            ← ホーム
          </Link>
        </div>
        <h1 className="text-lg font-semibold text-gray-900">閲覧フィルタ</h1>
        <p className="mt-1 text-sm text-gray-600">
          タイムラインと返信の、攻撃的とみなす内容の扱いです。
        </p>

        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-gray-800">フィルタの強さ</h2>
          <p className="mt-1 text-xs text-gray-500">
            {TOXICITY_FILTER_LEVEL_LABELS[level]}
          </p>
          <div className="mt-4 px-1">
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={levelIndex >= 0 ? levelIndex : 2}
              onChange={(e) => setLevelIndex(Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-sky-600"
              aria-valuemin={0}
              aria-valuemax={3}
              aria-valuenow={levelIndex}
            />
            <div className="mt-2 flex justify-between text-[10px] text-gray-500">
              <span>厳</span>
              <span>やや厳</span>
              <span>標準</span>
              <span>オフ</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1">
            {LEVELS.map((lv, i) => (
              <button
                key={lv}
                type="button"
                onClick={() => setLevel(lv)}
                className={[
                  "rounded-md py-2 text-xs font-medium",
                  level === lv
                    ? "bg-sky-600 text-white"
                    : "border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100",
                ].join(" ")}
              >
                {TOXICITY_FILTER_LEVEL_LABELS[lv].split("（")[0]}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-gray-800">
            閾値を超えたとき
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            非表示にするか、折りたたみで見せるか
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-2">
              <span
                className={[
                  "text-2xl",
                  behavior === "hide" ? "opacity-100" : "opacity-40",
                ].join(" ")}
                title="非表示"
              >
                🚫
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={behavior === "fold"}
                onClick={() =>
                  setBehavior((b) => (b === "hide" ? "fold" : "hide"))
                }
                className={[
                  "relative h-9 w-16 shrink-0 rounded-full transition-colors",
                  behavior === "fold" ? "bg-sky-500" : "bg-gray-300",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-1 h-7 w-7 rounded-full bg-white shadow transition-transform",
                    behavior === "fold" ? "translate-x-8" : "translate-x-1",
                  ].join(" ")}
                />
              </button>
              <span
                className={[
                  "text-2xl",
                  behavior === "fold" ? "opacity-100" : "opacity-40",
                ].join(" ")}
                title="折りたたみ"
              >
                📂
              </span>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-gray-600">
            {behavior === "hide"
              ? "タイムラインに載せない"
              : "カードを折りたたんで表示"}
          </p>
        </section>

        <button
          type="button"
          disabled={saving || !uid}
          onClick={() => void save()}
          className="mt-6 w-full rounded-lg bg-sky-600 py-3 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>

        {toast?.trim() ? (
          <p className="mt-3 text-center text-sm text-gray-700">{toast}</p>
        ) : null}
      </div>
    </main>
  );
}
