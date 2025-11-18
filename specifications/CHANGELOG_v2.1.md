# Sakemaru Core API v2.1 変更ログ

**リリース日**: 2025年11月18日
**重要度**: 🔴 高（破壊的変更あり）

---

## 📌 重要なお知らせ

このバージョンには**破壊的変更**が含まれています。
ローカルプリンターシステムのコード修正が必要です。

---

## 🎯 変更サマリー

| 変更内容 | タイプ | 影響度 | 対応必須 |
|---------|-------|--------|---------|
| `printer_id` → `printer_index` | 破壊的変更 | 高 | ✓ 必須 |
| 接続テストAPI追加 | 新機能 | 中 | 推奨 |
| 認証設定の統一 | 改善 | 低 | - |

---

## 💥 破壊的変更

### 1. APIレスポンスフィールド名の変更

**対象エンドポイント**: `GET /api/printer/polling`

#### 変更内容

```diff
{
  "printer_drivers": {
    "print_driver_name": "HP LaserJet Pro",
    "warehouse_id": 1,
-   "printer_id": 1,
+   "printer_index": 1,
    "warehouse": {...}
  }
}
```

#### 必要な対応

**JavaScript コード:**
```javascript
// ❌ 修正前
const printerId = job.printer_drivers?.printer_id ?? 0;

// ✅ 修正後
const printerIndex = job.printer_drivers?.printer_index ?? 0;
```

**影響範囲:**
- ポーリング処理
- ジョブ処理ロジック
- プリンター選択ロジック

**期限**: なるべく早く（後方互換性なし）

---

### 2. プリンタードライバー作成APIパラメータ変更

**対象エンドポイント**: `POST /api/printer/driver`

#### 変更内容

```diff
{
  "warehouse_id": 1,
- "printer_id": 1,
+ "printer_index": 1,
  "print_driver_name": "HP LaserJet Pro"
}
```

#### 必要な対応

プリンタードライバー登録機能を使用している場合のみ対応が必要です。

---

## 🆕 新機能

### 接続テストエンドポイント

サーバーとの通信を確認するための新しいエンドポイントが追加されました。

#### エンドポイント

```
GET /api/printer/test
```

#### レスポンス例

```json
{
  "success": true,
  "data": {
    "message": "Connection successful",
    "status": "ok",
    "timestamp": "2025-11-18T10:30:00+09:00",
    "client_id": 1,
    "server_version": "1.0.0"
  }
}
```

#### 使用例

```javascript
async function testConnection() {
  const response = await fetch(`${apiHost}/api/printer/test`, {
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    }
  });

  return response.ok;
}
```

#### メリット

- ✅ 初期セットアップ時の接続確認
- ✅ トラブルシューティングの簡素化
- ✅ ヘルスチェックに利用可能

---

## 🔧 改善

### 認証設定の統一

#### 変更内容

- 環境変数 `PRINTER_API_BEARER_KEY` を使用
- `config/auth.php` 経由でトークン管理
- config キャッシュに対応

#### メリット

- パフォーマンス向上
- テストが容易
- Laravel のベストプラクティスに準拠

**ローカルプリンターシステム側の変更:** なし

---

## 📋 マイグレーションチェックリスト

### 必須タスク

- [ ] **コード修正**: `printer_id` → `printer_index`
- [ ] **動作確認**: 実サーバーでテスト
- [ ] **エラーハンドリング**: 適切に処理されるか確認

### 推奨タスク

- [ ] **接続テスト機能追加**: 設定画面にボタン追加
- [ ] **起動時チェック**: アプリ起動時に接続確認
- [ ] **ログ出力**: 変更箇所のログを追加
- [ ] **ドキュメント更新**: ユーザーマニュアル更新

### オプションタスク

- [ ] **定期ヘルスチェック**: バックグラウンドで接続監視
- [ ] **接続失敗時の通知**: デスクトップ通知を追加
- [ ] **再接続ロジック**: 自動リトライ機能

---

## 📖 実装ガイド

### 最小限の修正（5分）

```javascript
// 1. フィールド名を変更
- const printerId = job.printer_drivers?.printer_id ?? 0;
+ const printerIndex = job.printer_drivers?.printer_index ?? 0;

// 2. 変数名を統一
- const printerName = config[`printer${printerId}`];
+ const printerName = config[`printer${printerIndex}`];
```

### 推奨実装（30分）

上記に加えて:

```javascript
// 3. 接続テスト関数を追加
async function testConnection() {
  const apiUrl = `https://${config.apiHost}/api/printer/test`;
  const response = await fetch(apiUrl, {
    headers: {
      'Authorization': `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json'
    }
  });
  return response.ok;
}

// 4. アプリ起動時にテスト
app.on('ready', async () => {
  if (!await testConnection()) {
    showErrorDialog('サーバー接続エラー', '設定を確認してください');
  }
  createWindow();
});
```

---

## 🧪 テスト方法

### 1. cURLでテスト

```bash
# 接続テスト
curl -X GET "https://tani-hub.sakemaru.click/api/printer/test" \
  -H "Authorization: Bearer YOUR_API_TOKEN"

# ポーリングテスト（printer_indexの確認）
curl -X GET "https://tani-hub.sakemaru.click/api/printer/polling" \
  -H "Authorization: Bearer YOUR_API_TOKEN" | grep printer_index
```

### 2. アプリ内でテスト

```javascript
// 開発者ツールで実行
(async () => {
  const testResult = await testConnection();
  console.log('接続テスト:', testResult ? '✓ 成功' : '✗ 失敗');

  await pollTask();
  console.log('ポーリング完了');
})();
```

---

## ⚠️ トラブルシューティング

### printer_index が undefined

**原因**: サーバー側が v2.1 にアップデートされていない

**一時的な対処**:
```javascript
const printerIndex = job.printer_drivers?.printer_index
                  ?? job.printer_drivers?.printer_id  // 後方互換
                  ?? 0;
```

### 接続テストが 401 エラー

**原因**: APIトークンが正しくない

**解決方法**:
1. サーバーの `.env` で `PRINTER_API_BEARER_KEY` を確認
2. `config.json` の `apiToken` を同じ値に設定
3. アプリを再起動

---

## 📚 関連ドキュメント

| ドキュメント | 説明 | 対象 |
|------------|------|------|
| [API_UPDATE_v2.1_IMPLEMENTATION.md](./API_UPDATE_v2.1_IMPLEMENTATION.md) | 詳細な実装ガイド | 開発者 |
| [CONNECTION_TEST_GUIDE.md](./CONNECTION_TEST_GUIDE.md) | 接続テストの使い方 | 全員 |
| [SAKEMARU_CORE_API_REFERENCE2.md](./SAKEMARU_CORE_API_REFERENCE2.md) | 完全なAPIリファレンス | 開発者 |
| [UPDATE_GUIDE_v2.1.md](./UPDATE_GUIDE_v2.1.md) | サーバー側の更新ガイド | サーバー管理者 |

---

## 📞 サポート

質問や問題がある場合:

1. まず [CONNECTION_TEST_GUIDE.md](./CONNECTION_TEST_GUIDE.md) を確認
2. 接続テストを実行
3. ログファイルを確認
4. 開発チームに連絡（ログとエラー内容を添付）

---

## 🎉 次のステップ

1. ✅ このドキュメントを読む
2. ✅ [API_UPDATE_v2.1_IMPLEMENTATION.md](./API_UPDATE_v2.1_IMPLEMENTATION.md) で詳細を確認
3. ✅ コードを修正
4. ✅ テスト環境で動作確認
5. ✅ 本番環境にデプロイ

---

**更新履歴:**

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2025-11-18 | v2.1.0 | 初版リリース |
