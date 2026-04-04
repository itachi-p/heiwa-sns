# Nagi SNS — 網羅・透明性版（詳細を読む人向け）

**前提**: [INVITE_AT_A_GLANCE.md](INVITE_AT_A_GLANCE.md) と [INVITE_OVERVIEW.md](INVITE_OVERVIEW.md) を読んだうえで、**設計の根拠・実装の置き方・検証**まで追いたい方向けです。

---

## 1. 透明性について

このリポジトリは、**意思決定と却下した案**を文章で残すことを優先します。

| 内容 | ファイル |
|------|-----------|
| 採用/見送りのログ（時系列） | [DECISIONS.md](DECISIONS.md) |
| 前提・見送り案・未決事項 | [ASSUMPTIONS_AND_REJECTED_IDEAS.md](ASSUMPTIONS_AND_REJECTED_IDEAS.md) |
| DB の意図（真実は migrations） | [schema.md](schema.md) |
| **数式・閾値つきの実装要約** | [dev/IMPLEMENTATION_REFERENCE.md](dev/IMPLEMENTATION_REFERENCE.md) |

「コードが正」です。文章が古い場合は **コードと `dev/IMPLEMENTATION_REFERENCE.md` を優先**し、差分があればドキュメントの更新を歓迎します。

---

## 2. タイムライン・スキ・毒性（実装の芯）

- **タイムライン順**: 5 分スロット単位で **新しさが先**。**スキ**（`user_affinity.like_score`）は **同一スロット内の微調整**に限定。無制限に古い投稿を押し上げない。
- **毒性フィルタ**: 閲覧者のレベル（`strict` / `soft` / `normal` / `off`）と `moderation_max_score`（ノイズフロア適用後）で **他人投稿を除外**。自分の投稿は残す。
- **5 指標の内訳**: **DB には保存しない**（max のみ）。クライアント側保持の理由と手順は [PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md](PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md) §8。

---

## 3. 検証・回帰

- **Playwright** の方針・起動手順・タイムライン手動検証: [PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md](PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md)。
- 公開準備のチェック: [LAUNCH_PLAN.md](LAUNCH_PLAN.md)。

---

## 4. 想定ユーザー像

[TARGET_AUDIENCE.md](TARGET_AUDIENCE.md)（向いている人 / 向かないかもしれない人）。

---

## 5. 開発者・Cursor 向けの「守る場所」

変更の一貫性のため、次を **常時参照**します（詳細は各ファイル先頭）。

- `.cursor/rules/documentation-and-principles.mdc` — ドキュメント階層と不変条件
- `.cursor/rules/database-and-migrations.mdc` — マイグレーション・スキーマ
- `.cursor/rules/agent-workflow.mdc` — 再発時の運用

全索引: [README.md](README.md)。
