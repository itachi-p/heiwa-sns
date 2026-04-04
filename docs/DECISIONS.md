# Decisions Log

This file records meaningful product and architecture decisions.
Use newest-first entries.

## Writing Rules (to avoid uncontrolled growth)

- Keep one decision as one section.
- Record `Context`, `Options`, `Decision`, `Consequences` only.
- Link to external/public explanation only when needed.
- If superseded, do not delete history; mark it as `superseded`.

---

## 2026-04-02

### 投稿者向け毒性注意の閾値を閲覧「標準」（0.7）に統一

- **Status:** accepted
- **Context:** 旧下書きでは「高スコア非表示」が 0.9 付近の説明と、閲覧デフォルト（標準 0.7）が食い違っていた。運用テスト上、0.7 で十分攻撃的と判断。
- **Decision:** `HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD` を **`TOXICITY_THRESHOLDS.normal` と同一**（現状 0.7）にする。トースト等の**文言・表示形式は変更しない**。閲覧者が「フィルタしない」(off / 1.0) のときのみ、0.7 超の他人投稿もタイムライン・リプでそのまま見える（従来の閾値比較のまま）。
- **Consequences:** 0.7〜0.8 帯の投稿・返信でも投稿者に注意が出る。`docs/dev/IMPLEMENTATION_REFERENCE.md` を更新。

### `docs/SYSTEM_SPEC.md` をリポジトリから削除

- **Status:** accepted
- **Context:** ChatGPT 生成下書きをローカル保持。スタブのみだと `docs` が冗長。
- **Decision:** リポジトリからファイルを削除。正は `docs/dev/IMPLEMENTATION_REFERENCE.md` とコード。
- **Consequences:** 旧パスへのリンクは残さない。

### リプ欄だけ閾値を厳しくする案・タイムライン/リプで別フィルタ設定（保留）

- **Status:** deferred (open)
- **Context:** リプのみ 0.5 等に下げる案は廃案ではない。ユーザー毎にフィルタを二系統に分ける案も検討余地あり。現状は同一 `toxicity_filter_level`。
- **Decision:** **当面実装しない**（未実装機能を優先）。
- **Consequences:** 着手時は閾値の供給元、`replyVisibilityThreshold`、`ReplyThread`、プロフィール UI、`IMPLEMENTATION_REFERENCE.md` をまとめて設計する。

### `docs` の段階別再編と実装参照の一本化

- **Status:** accepted
- **Context:** 下書きと実装の乖離、README と複数 md の役割重複、Cursor が参照すべき「正」の分散。
- **Decision:** `docs/README.md` を索引とする。招待向けは `INVITE_AT_A_GLANCE.md` / `INVITE_OVERVIEW.md` / `INVITE_DEEP_DIVE.md`。アルゴリズム・閾値の要約は `docs/dev/IMPLEMENTATION_REFERENCE.md` に集約。`RATIONALE_PUBLIC.md` はリダイレクト用スタブ。Cursor に `.cursor/rules/documentation-and-principles.mdc`（`alwaysApply: true`）を追加。
- **Consequences:** タイムライン・毒性・スキの挙動を変えたら `IMPLEMENTATION_REFERENCE.md` を同じ変更で更新する。手動検証に影響があれば `PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md` も更新。

---

## 2026-03-24

### 「いいね」表記を「スキ」へ変更し、フォロー/ブロックは実装しない（当面）

- **Status:** provisional (accepted)
- **Context:**  
  数値指標や関係の固定化が、比較・対立・排除のインセンティブになりやすい。  
  そのため、典型的SNSの「フォロー/ブロック」をそのまま持ち込まず、別の設計で同等以上の安全性と快適さを狙う。
- **Options:**  
  - **A案:** 典型的な「いいね/フォロー/ブロック」を実装し、運用で抑える  
  - **B案:** フォローのみ実装し、ブロックもユーザー任意で提供  
  - **C案:** 反応は「スキ」に寄せ、フォロー/ブロックは実装しない（必要時は管理者対応）  
- **Decision:**  
  **C案を当面の方針とする。** 「自分と意見が違うから排除したい」用途の任意ブロックを避け、代替は「表示優先度制御（AI判定を含む）」と運用で担保する。
- **Consequences:**  
  - 典型的SNSの操作感とは異なるため、オンボーディングで期待値調整が必要  
  - 緊急性の高い遮断が必要なケースは、管理者依頼の導線を用意する必要がある  

### DM は原則未実装、実装する場合は安全性を優先した制限を前提とする

- **Status:** provisional
- **Context:**  
  DM は「名指しで確実に届き、必ず見られる」性質があり、タイムラインの安全設計の抜け道になり得る。
- **Decision:**  
  DM を実装しない、または実装する場合でも **AI判定を通過したものだけが送信される**等の制限を前提に検討する。
- **Consequences:**  
  - 利便性は下がるが、初期フェーズの安全性と信頼を優先できる  
  - 実装するなら「誤検知/見逃し」も含めた説明可能性が重要になる  

### 投稿者アカウント信頼度の扱い（A〜C比較、C案を仮採用）

- **Status:** provisional (accepted)
- **Context:**  
  当初は「アカウント単位の信頼度スコアを100点開始で減点し、表示優先度を全体的に下げ、さらに公開する」案を想定していた。  
  ただし、ラベリング・萎縮・再起困難の副作用が強く、プロダクト理念（人を数で評価しない）と衝突する懸念が出た。
- **Options:**  
  - **A案:** アカウント単位スコアを内部保持し、表示優先度に反映（スコアは非公開）  
  - **B案:** アカウント単位スコアを内部保持し、表示優先度に反映し、スコアも公開  
  - **C案:** アカウント単位スコアを採用しない。投稿単位で扱い、公開数値は持たない
- **Decision:**  
  **C案を仮採用。** 数値ラベリングを避け、必要な制御は投稿単位・文脈単位で行う。
- **Consequences:**  
  - アカウントの恒久的な「低評価レッテル」を防ぎやすい  
  - 説明責任は「投稿ごとの理由提示」で担保する設計が必要  
  - 将来の外部公開時に「なぜスコア制を採用しないか」を説明しやすい

### Keep README external-facing; move internal context to docs

- **Status:** accepted
- **Why:** README should stay readable for new visitors.
- **Decision:** Store assumptions, rejected ideas, and rationale in `docs/`.
- **Impact:** Context survives chat/session changes and is versioned in Git.

### Likes store relationship only

- **Status:** accepted
- **Why:** Preserve calm interaction and avoid score competition.
- **Decision:** Record `{ user_id, post_id }` in `likes`, but do not display totals.
- **Impact:** Supports intent tracking without public numeric pressure.

### Nickname uniqueness required

- **Status:** accepted
- **Why:** Avoid identity ambiguity and impersonation-like confusion.
- **Decision:** Enforce unique nickname with DB constraint and user-facing message.
- **Impact:** Clear identity expectations during onboarding.
