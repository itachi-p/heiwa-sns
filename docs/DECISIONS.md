# Decisions Log

This file records meaningful product and architecture decisions.
Use newest-first entries.

## Writing Rules (to avoid uncontrolled growth)

- Keep one decision as one section.
- Record `Context`, `Options`, `Decision`, `Consequences` only.
- Link to external/public explanation only when needed.
- If superseded, do not delete history; mark it as `superseded`.

---

## 2026-03-24

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
