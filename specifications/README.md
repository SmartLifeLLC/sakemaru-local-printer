# Sakemaru ローカルプリンター 仕様書

このディレクトリには、Sakemaru ローカルプリンターシステムの技術仕様書が格納されています。

---

## 📚 ドキュメント一覧

### 🆕 最新情報（v2.1 対応）

| ドキュメント | 説明 | 対象者 | 必読 |
|------------|------|--------|------|
| [CHANGELOG_v2.1.md](./CHANGELOG_v2.1.md) | **v2.1 変更ログ**<br>破壊的変更と新機能のサマリー | 全員 | ✓ |
| [API_UPDATE_v2.1_IMPLEMENTATION.md](./API_UPDATE_v2.1_IMPLEMENTATION.md) | **v2.1 実装ガイド**<br>コード修正の詳細手順 | 開発者 | ✓ |
| [CONNECTION_TEST_GUIDE.md](./CONNECTION_TEST_GUIDE.md) | **接続テストガイド**<br>サーバー接続確認方法 | 全員 | ✓ |

### 📖 APIリファレンス

| ドキュメント | 説明 | バージョン |
|------------|------|----------|
| [SAKEMARU_CORE_API_REFERENCE2.md](./SAKEMARU_CORE_API_REFERENCE2.md) | 完全なAPIリファレンス（v2.0） | v2.0+ |
| [SAKEMARU_CORE_API_REFERENCE.md](./SAKEMARU_CORE_API_REFERENCE.md) | 旧APIリファレンス（v1.x） | v1.x（非推奨） |

### 🔧 サーバー側ドキュメント

| ドキュメント | 説明 | 対象者 |
|------------|------|--------|
| [UPDATE_GUIDE_v2.1.md](./UPDATE_GUIDE_v2.1.md) | サーバー側の更新ガイド | サーバー管理者 |

### 🛠️ その他

| ドキュメント | 説明 | 対象者 |
|------------|------|--------|
| [1-muliple-printer-setup.md](./1-muliple-printer-setup.md) | 複数プリンター設定 | 運用担当者 |
| [API_SPECIFICATION.md](./API_SPECIFICATION.md) | 旧仕様書 | 参考用 |

---

## 🚀 クイックスタート

### 新規セットアップする場合

1. ✅ [CHANGELOG_v2.1.md](./CHANGELOG_v2.1.md) で変更点を把握
2. ✅ [API_UPDATE_v2.1_IMPLEMENTATION.md](./API_UPDATE_v2.1_IMPLEMENTATION.md) を参照して実装
3. ✅ [CONNECTION_TEST_GUIDE.md](./CONNECTION_TEST_GUIDE.md) で接続テスト実行

### 既存システムをアップデートする場合

1. ✅ [CHANGELOG_v2.1.md](./CHANGELOG_v2.1.md) で破壊的変更を確認
2. ✅ [API_UPDATE_v2.1_IMPLEMENTATION.md](./API_UPDATE_v2.1_IMPLEMENTATION.md) のチェックリストに従う
3. ✅ コードを修正（`printer_id` → `printer_index`）
4. ✅ 接続テスト機能を追加（推奨）
5. ✅ テスト環境で動作確認
6. ✅ 本番環境にデプロイ

### トラブルシューティング

1. ✅ [CONNECTION_TEST_GUIDE.md](./CONNECTION_TEST_GUIDE.md) で接続テスト実行
2. ✅ [CHANGELOG_v2.1.md](./CHANGELOG_v2.1.md) のトラブルシューティングセクション確認
3. ✅ ログファイルを確認
4. ✅ それでも解決しない場合は開発チームに連絡

---

## 📌 重要なお知らせ

### v2.1 の破壊的変更

**必ず対応が必要です:**

```diff
// APIレスポンスフィールド名が変更
{
  "printer_drivers": {
-   "printer_id": 1,
+   "printer_index": 1,
  }
}
```

**コード修正例:**
```javascript
// ❌ 修正前
const printerId = job.printer_drivers?.printer_id ?? 0;

// ✅ 修正後
const printerIndex = job.printer_drivers?.printer_index ?? 0;
```

詳細は [API_UPDATE_v2.1_IMPLEMENTATION.md](./API_UPDATE_v2.1_IMPLEMENTATION.md) を参照してください。

---

## 🆕 新機能: 接続テスト API

サーバーとの通信を確認できる新しいエンドポイントが追加されました。

**エンドポイント:**
```
GET /api/printer/test
```

**使い方:**
```javascript
const response = await fetch(`${apiHost}/api/printer/test`, {
  headers: { 'Authorization': `Bearer ${apiToken}` }
});

if (response.ok) {
  console.log('✓ 接続成功');
}
```

詳細は [CONNECTION_TEST_GUIDE.md](./CONNECTION_TEST_GUIDE.md) を参照してください。

---

## 🎯 バージョン対応表

| ローカルプリンター | サーバー側API | 互換性 | 推奨 |
|-----------------|-------------|--------|------|
| v2.1+ | v2.1+ | ✓ 完全互換 | ✓ 推奨 |
| v2.0 | v2.1 | △ 部分互換 | - |
| v1.x | v2.1 | ✗ 非互換 | - |

**注意**: v2.0以前のローカルプリンターは v2.1対応が必須です。

---

## 📞 サポート

### よくある質問

**Q: どのドキュメントから読めばいいですか？**

A: 以下の順番で読むことを推奨します:
1. [CHANGELOG_v2.1.md](./CHANGELOG_v2.1.md) - 変更点の把握
2. [API_UPDATE_v2.1_IMPLEMENTATION.md](./API_UPDATE_v2.1_IMPLEMENTATION.md) - 実装方法
3. [CONNECTION_TEST_GUIDE.md](./CONNECTION_TEST_GUIDE.md) - 接続確認

**Q: サーバー側の変更も必要ですか？**

A: サーバー側は既に v2.1 にアップデート済みです。ローカルプリンター側の対応のみ必要です。

**Q: いつまでに対応が必要ですか？**

A: 後方互換性がないため、**なるべく早く**対応してください。

### 連絡先

- 技術的な質問: 開発チーム
- ドキュメントの誤り: GitHub Issues
- 緊急の問題: サポート窓口

---

## 📝 更新履歴

| 日付 | 変更内容 |
|------|---------|
| 2025-11-18 | v2.1 関連ドキュメント追加 |
| 2025-11-18 | README 作成 |

---

**最終更新**: 2025年11月18日
**バージョン**: v2.1
