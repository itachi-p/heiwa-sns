"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchToxicityFilterLevel,
  fetchToxicityOverThresholdBehavior,
} from "@/lib/timeline-threshold";
import {
  TOXICITY_FILTER_SELECT_ORDER,
  type ToxicityFilterLevel,
  type ToxicityOverThresholdBehavior,
} from "@/lib/toxicity-filter-level";
import { notifyViewerToxicityUpdated } from "@/components/viewer-toxicity-bus";

const supabase = createClient();
const LEVELS = TOXICITY_FILTER_SELECT_ORDER;

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ToxicitySettingsModal({ open, onClose }: Props) {
  const [uid, setUid] = useState<string | null>(null);
  const [level, setLevel] = useState<ToxicityFilterLevel>("normal");
  const [behavior, setBehavior] =
    useState<ToxicityOverThresholdBehavior>("hide");
  const [saving, setSaving] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      const id = session?.user?.id ?? null;
      if (!id) {
        onClose();
        return;
      }
      setUid(id);
      setErrorToast(null);
      setLevel(await fetchToxicityFilterLevel(supabase, id));
      setBehavior(await fetchToxicityOverThresholdBehavior(supabase, id));
    })();
    return () => {
      cancelled = true;
    };
    // onClose はレイアウトの安定したコールバックを渡す
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときだけ再読込
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const levelIndex = LEVELS.indexOf(level);
  const setLevelIndex = (i: number) => {
    const next = LEVELS[Math.max(0, Math.min(3, i))];
    if (next) setLevel(next);
  };

  const save = async () => {
    if (!uid) return;
    setSaving(true);
    setErrorToast(null);
    const { error } = await supabase
      .from("users")
      .update({
        toxicity_filter_level: level,
        toxicity_over_threshold_behavior: behavior,
      })
      .eq("id", uid);
    setSaving(false);
    if (error) {
      setErrorToast(error.message);
      return;
    }
    notifyViewerToxicityUpdated();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="flex min-h-0 max-h-[min(88dvh,32rem)] w-full max-w-md flex-col rounded-t-2xl border border-gray-200 bg-white shadow-xl sm:max-h-[min(85vh,28rem)] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="toxicity-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2
            id="toxicity-settings-title"
            className="text-base font-semibold text-gray-900"
          >
            閲覧フィルタ
          </h2>
          <button
            type="button"
            onClick={() => {
              if (!saving) onClose();
            }}
            className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
            aria-label="閉じる"
          >
            <span className="text-xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <p className="text-sm text-gray-600">
            AIによる攻撃性判定値の処理方法
          </p>

          <section className="mt-4 rounded-lg border border-gray-100 bg-gray-50/80 p-3">
            <h3 className="text-xs font-medium text-gray-800">
              フィルタリング強度
            </h3>
            <div className="mt-3 px-0.5">
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
              <div className="mt-1.5 flex justify-between gap-0.5 text-[10px]">
                {[
                  { key: "strict", label: "厳" },
                  { key: "soft", label: "やや厳" },
                  { key: "normal", label: "標準" },
                  { key: "off", label: "オフ" },
                ].map((item) => (
                  <span
                    key={item.key}
                    className={[
                      "min-w-0 text-center transition-colors",
                      level === item.key
                        ? "font-semibold text-gray-900"
                        : "font-normal text-gray-500",
                    ].join(" ")}
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-3 rounded-lg border border-gray-100 bg-gray-50/80 p-3">
            <h3 className="text-xs font-medium text-gray-800">
              設定を超えた投稿の表示設定
            </h3>
            <div className="mt-3 flex items-center justify-center gap-3">
              <span
                className={[
                  "shrink-0 text-sm font-medium",
                  behavior === "hide" ? "text-gray-900" : "text-gray-400",
                ].join(" ")}
              >
                非表示
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={behavior === "fold"}
                aria-label={
                  behavior === "fold"
                    ? "折りたたみで表示（タップで本文を表示）"
                    : "タイムラインから非表示"
                }
                onClick={() =>
                  setBehavior((b) => (b === "hide" ? "fold" : "hide"))
                }
                className={[
                  "relative h-8 w-[3.25rem] shrink-0 rounded-full transition-colors",
                  behavior === "fold" ? "bg-sky-500" : "bg-gray-300",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-all duration-200",
                    behavior === "fold" ? "right-1" : "left-1",
                  ].join(" ")}
                />
              </button>
              <span
                className={[
                  "shrink-0 text-sm font-medium",
                  behavior === "fold" ? "text-gray-900" : "text-gray-400",
                ].join(" ")}
              >
                折りたたみ
              </span>
            </div>
            <p className="mt-2 text-center text-xs text-gray-600">
              {behavior === "hide"
                ? "タイムラインに載せない"
                : "タップで表示"}
            </p>
          </section>

          {errorToast?.trim() ? (
            <p className="mt-3 text-center text-sm text-red-700" role="alert">
              {errorToast}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            disabled={saving || !uid}
            onClick={() => void save()}
            className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
