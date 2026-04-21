import { useEffect, type MutableRefObject, type RefObject } from "react";

import type { DevScoresById } from "@/lib/dev-scores-local-storage";
import { persistModerationDevScores } from "@/lib/persist-moderation-dev-scores-client";
import {
  fetchPerspectiveScoresForText,
  loadPostIdsPendingSecondModeration,
  loadReplyIdsPendingSecondModeration,
  removePostNeedsSecondModeration,
  removeReplyNeedsSecondModeration,
} from "@/lib/pending-second-moderation";
import { isPastInitialEditWindow } from "@/lib/second-moderation-timing";
import type { TimelinePost, TimelinePostReply } from "@/lib/timeline-types";

/**
 * 投稿・返信の本文確定後（＝編集窓終了後）に 2 回目のモデレーション採点を
 * 行い、DB の `moderation_dev_scores.second` に永続化するループ。
 *
 * 旧 `app/(main)/page.tsx` の約 150 行の useEffect をそのまま hook 化。
 * 挙動は一切変えていない。依存は引数で渡し、内部で useEffect を 1 つ張る。
 *
 * - 既に state 側に second がある行は DB 永続化だけ試みる
 * - まだ無い行は Perspective API で再採点 → state + DB 永続化
 * - 実行中キーは `busyRef` で重複実行をブロック
 * - effect クリーンアップ時に `cancelled` を立てて以降の setState を止める
 */
export function useSecondModerationLoop(args: {
  authReady: boolean;
  posts: TimelinePost[];
  repliesByPost: Record<number, TimelinePostReply[]>;
  postScoresById: DevScoresById;
  replyScoresById: DevScoresById;
  userId: string | null;
  expiryTick: number;
  postScoresByIdRef: RefObject<DevScoresById>;
  replyScoresByIdRef: RefObject<DevScoresById>;
  busyRef: MutableRefObject<Set<string>>;
  setPostScoresById: (
    updater: (prev: DevScoresById) => DevScoresById
  ) => void;
  setReplyScoresById: (
    updater: (prev: DevScoresById) => DevScoresById
  ) => void;
}): void {
  const {
    authReady,
    posts,
    repliesByPost,
    postScoresById,
    replyScoresById,
    userId,
    expiryTick,
    postScoresByIdRef,
    replyScoresByIdRef,
    busyRef,
    setPostScoresById,
    setReplyScoresById,
  } = args;

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;

    void (async () => {
      for (const postId of loadPostIdsPendingSecondModeration()) {
        if (cancelled) return;
        const post = posts.find((p) => p.id === postId);
        if (!post) {
          removePostNeedsSecondModeration(postId);
          continue;
        }
        if (post.pending_content?.trim()) continue;

        if (!isPastInitialEditWindow(post.created_at)) {
          continue;
        }

        const prev = postScoresByIdRef.current ?? {};
        const existingSecond = prev[postId]?.second;
        if (existingSecond && Object.keys(existingSecond).length > 0) {
          const busyKey = `p:${postId}`;
          if (busyRef.current.has(busyKey)) continue;
          busyRef.current.add(busyKey);
          try {
            const persistRes = await persistModerationDevScores({
              postId,
              patch: { second: existingSecond },
            });
            if (persistRes.ok) removePostNeedsSecondModeration(postId);
          } catch (e) {
            console.warn("persist second post:", e);
          } finally {
            busyRef.current.delete(busyKey);
          }
          continue;
        }

        const busyKey = `p:${postId}`;
        if (busyRef.current.has(busyKey)) continue;
        busyRef.current.add(busyKey);
        try {
          const text = (post.content ?? "").trim();
          if (!text) {
            removePostNeedsSecondModeration(postId);
            continue;
          }
          const scores = await fetchPerspectiveScoresForText(text);
          if (cancelled) return;
          if (Object.keys(scores).length === 0) {
            removePostNeedsSecondModeration(postId);
            continue;
          }
          setPostScoresById((p) => {
            if (p[postId]?.second) return p;
            const row = p[postId] ?? {};
            return { ...p, [postId]: { ...row, second: scores } };
          });
          const persistRes = await persistModerationDevScores({
            postId,
            patch: { second: scores },
          });
          if (persistRes.ok) removePostNeedsSecondModeration(postId);
        } catch (e) {
          console.warn("second moderation row:", e);
        } finally {
          busyRef.current.delete(busyKey);
        }
      }

      for (const replyId of loadReplyIdsPendingSecondModeration()) {
        if (cancelled) return;
        const reply = Object.values(repliesByPost)
          .flat()
          .find((r) => r.id === replyId);
        if (!reply) {
          removeReplyNeedsSecondModeration(replyId);
          continue;
        }
        if (reply.pending_content?.trim()) continue;

        if (!isPastInitialEditWindow(reply.created_at)) {
          continue;
        }

        const rprev = replyScoresByIdRef.current ?? {};
        const rExistingSecond = rprev[replyId]?.second;
        if (rExistingSecond && Object.keys(rExistingSecond).length > 0) {
          const busyKey = `r:${replyId}`;
          if (busyRef.current.has(busyKey)) continue;
          busyRef.current.add(busyKey);
          try {
            const persistRes = await persistModerationDevScores({
              replyId,
              patch: { second: rExistingSecond },
            });
            if (persistRes.ok) removeReplyNeedsSecondModeration(replyId);
          } catch (e) {
            console.warn("persist second reply:", e);
          } finally {
            busyRef.current.delete(busyKey);
          }
          continue;
        }

        const busyKey = `r:${replyId}`;
        if (busyRef.current.has(busyKey)) continue;
        busyRef.current.add(busyKey);
        try {
          const text = (reply.content ?? "").trim();
          if (!text) {
            removeReplyNeedsSecondModeration(replyId);
            continue;
          }
          const scores = await fetchPerspectiveScoresForText(text);
          if (cancelled) return;
          if (Object.keys(scores).length === 0) {
            removeReplyNeedsSecondModeration(replyId);
            continue;
          }
          setReplyScoresById((p) => {
            if (p[replyId]?.second) return p;
            const row = p[replyId] ?? {};
            return { ...p, [replyId]: { ...row, second: scores } };
          });
          const persistRes = await persistModerationDevScores({
            replyId,
            patch: { second: scores },
          });
          if (persistRes.ok) removeReplyNeedsSecondModeration(replyId);
        } catch (e) {
          console.warn("second moderation row (reply):", e);
        } finally {
          busyRef.current.delete(busyKey);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    posts,
    repliesByPost,
    postScoresById,
    replyScoresById,
    userId,
    expiryTick,
    postScoresByIdRef,
    replyScoresByIdRef,
    busyRef,
    setPostScoresById,
    setReplyScoresById,
  ]);
}
