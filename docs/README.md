# ドキュメント索引（Nagi SNS）

**しばしば書き換えない前提**の設計・仕様メモを、読者と粒度で分けています。  
**実装の真実は常にコード**（と `supabase/migrations/`）。文章は追従が遅れることがあるため、差分が出たら **コード側を正**として本ディレクトリを更新してください。

---

## 誰向けか（3段階）

| 段階 | ファイル | 目的 |
|------|-----------|------|
| **即読・コア**（先行招待向け） | [`INVITE_AT_A_GLANCE.md`](INVITE_AT_A_GLANCE.md) | 数分で「何をしないSNSか」が掴める |
| **概要・やや詳しい** | [`INVITE_OVERVIEW.md`](INVITE_OVERVIEW.md) | 思想・向き/不向き・技術スタンスの中くらいの分量 |
| **網羅・透明性** | [`INVITE_DEEP_DIVE.md`](INVITE_DEEP_DIVE.md) | 意思決定ログ・前提/見送り・実装参照・検証手順への導線 |

英語の短い原則だけ欲しい場合は [`PRODUCT_PRINCIPLES.md`](PRODUCT_PRINCIPLES.md)（変更時は和文側との整合を確認）。

---

## 開発者・Cursor が触る前に読むもの

| 優先度 | 内容 | ファイル |
|--------|------|-----------|
| **高** | プロダクト不変条件・判断基準 | [`PRODUCT_PRINCIPLES.md`](PRODUCT_PRINCIPLES.md)、[`DECISIONS.md`](DECISIONS.md) |
| **高** | タイムライン・毒性フィルタ・スキの**実装に即した**要約 | [`dev/IMPLEMENTATION_REFERENCE.md`](dev/IMPLEMENTATION_REFERENCE.md) |
| **高** | DB・マイグレーション禁止の境界 | リポジトリ `.cursor/rules/database-and-migrations.mdc` |
| **中** | E2E（Playwright）と手動検証 | [`PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md`](PLAYWRIGHT_AND_TIMELINE_VERIFICATION.md) |
| **中** | スキーマ意図（真実は migrations） | [`schema.md`](schema.md) |
| **中** | 前提・見送り案 | [`ASSUMPTIONS_AND_REJECTED_IDEAS.md`](ASSUMPTIONS_AND_REJECTED_IDEAS.md) |
| **運用** | 公開・パイロット準備 | [`LAUNCH_PLAN.md`](LAUNCH_PLAN.md) |

---

## Cursor ルールとの対応

- **ドキュメント階層・不変条件の遵守**: `.cursor/rules/documentation-and-principles.mdc`（`alwaysApply`）
- **DB 変更の禁止境界**: `.cursor/rules/database-and-migrations.mdc`
- **再発時の運用**: `.cursor/rules/agent-workflow.mdc`
