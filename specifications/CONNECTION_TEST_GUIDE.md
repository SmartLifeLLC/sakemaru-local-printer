# サーバー接続テスト ガイド

**対象**: ローカルプリンターシステム開発者・運用担当者
**難易度**: 初級
**所要時間**: 5分

---

## 概要

新しく追加された接続テストエンドポイント (`GET /api/printer/test`) を使用して、ローカルプリンターシステムとサーバーの通信が正常に行えるか確認する方法を説明します。

---

## 接続テストが必要な場面

### ✅ 以下の場合に必ず実行してください

1. **初期セットアップ時**
   - ローカルプリンターシステムを新規インストールした後
   - 設定ファイル (`config.json`) を編集した後

2. **トラブルシューティング時**
   - 印刷ジョブが取得できない
   - 認証エラーが発生する
   - ネットワーク接続が不安定

3. **定期メンテナンス時**
   - サーバー側のアップデート後
   - APIトークンを変更した後

---

## 方法1: コマンドラインでテスト（推奨）

### Windows (PowerShell)

```powershell
# 変数設定
$apiHost = "tani-hub.sakemaru.click"
$apiToken = "your-printer-api-bearer-key-here"

# 接続テスト実行
$response = Invoke-RestMethod -Uri "https://$apiHost/api/printer/test" `
  -Method Get `
  -Headers @{
    "Authorization" = "Bearer $apiToken"
    "Content-Type" = "application/json"
  }

# 結果表示
Write-Host "接続テスト結果:"
$response | ConvertTo-Json -Depth 10
```

### macOS / Linux (curl)

```bash
# 変数設定
API_HOST="tani-hub.sakemaru.click"
API_TOKEN="your-printer-api-bearer-key-here"

# 接続テスト実行
curl -X GET "https://$API_HOST/api/printer/test" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\n"
```

---

## 方法2: アプリケーション内でテスト

### 設定画面にボタンを追加（推奨実装）

#### HTML (config.html)

```html
<div class="connection-test-section">
  <h3>サーバー接続テスト</h3>
  <button id="testConnectionBtn" class="btn btn-primary">
    接続テスト実行
  </button>
  <div id="connectionStatus" class="status-message"></div>
</div>
```

#### JavaScript (renderer.js)

```javascript
// 接続テスト関数
async function testConnection() {
  const statusEl = document.getElementById('connectionStatus');
  statusEl.textContent = '接続テスト中...';
  statusEl.className = 'status-message loading';

  const apiUrl = `https://${config.apiHost}/api/printer/test`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const result = await response.json();

      // 成功表示
      statusEl.innerHTML = `
        <strong>✓ 接続成功</strong><br>
        サーバー: ${config.apiHost}<br>
        クライアントID: ${result.data.client_id}<br>
        サーバーバージョン: ${result.data.server_version}<br>
        タイムスタンプ: ${new Date(result.data.timestamp).toLocaleString('ja-JP')}
      `;
      statusEl.className = 'status-message success';

      return true;
    } else if (response.status === 401) {
      // 認証エラー
      statusEl.innerHTML = `
        <strong>✗ 認証エラー (401)</strong><br>
        APIトークンが正しくありません。<br>
        設定を確認してください。
      `;
      statusEl.className = 'status-message error';
      return false;
    } else {
      // その他のHTTPエラー
      statusEl.innerHTML = `
        <strong>✗ 接続失敗 (${response.status})</strong><br>
        ${response.statusText}
      `;
      statusEl.className = 'status-message error';
      return false;
    }
  } catch (error) {
    // ネットワークエラー
    statusEl.innerHTML = `
      <strong>✗ ネットワークエラー</strong><br>
      ${error.message}<br>
      サーバーに接続できません。
    `;
    statusEl.className = 'status-message error';
    return false;
  }
}

// イベントリスナー設定
document.getElementById('testConnectionBtn').addEventListener('click', async () => {
  await testConnection();
});
```

#### CSS (スタイル追加)

```css
.connection-test-section {
  margin: 20px 0;
  padding: 15px;
  border: 1px solid #ddd;
  border-radius: 5px;
}

.status-message {
  margin-top: 10px;
  padding: 10px;
  border-radius: 3px;
}

.status-message.loading {
  background-color: #f0f0f0;
  color: #666;
}

.status-message.success {
  background-color: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.status-message.error {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}
```

---

## 方法3: アプリ起動時の自動チェック

### main.js に実装

```javascript
const { app, BrowserWindow, dialog } = require('electron');

app.on('ready', async () => {
  // 設定読み込み
  loadConfig();

  // サーバー接続テスト
  writeLog('サーバー接続テストを実行中...', 'info');
  const connected = await testServerConnection();

  if (!connected) {
    // 接続失敗時は警告ダイアログを表示
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['設定画面を開く', 'スキップして起動'],
      defaultId: 0,
      title: 'サーバー接続エラー',
      message: 'サーバーに接続できませんでした',
      detail: '設定を確認してください。\n\nスキップして起動する場合、印刷機能は動作しません。'
    });

    if (choice === 0) {
      // 設定画面を開く
      createConfigWindow();
      return;
    }
  } else {
    writeLog('サーバー接続成功', 'success');
  }

  // メインウィンドウ作成
  createWindow();
});

async function testServerConnection() {
  const apiUrl = `https://${config.apiHost}/api/printer/test`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000  // 10秒タイムアウト
    });

    return response.ok;
  } catch (error) {
    writeLog(`サーバー接続エラー: ${error.message}`, 'error');
    return false;
  }
}
```

---

## レスポンスの確認

### ✅ 成功時のレスポンス (HTTP 200)

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

**確認ポイント:**
- ✅ `success: true` であること
- ✅ `status: "ok"` であること
- ✅ `client_id` が正しいこと
- ✅ `timestamp` が現在時刻に近いこと

### ❌ 認証エラー時のレスポンス (HTTP 401)

```json
{
  "message": "Unauthorized"
}
```

**原因:**
- APIトークン (`apiToken`) が正しくない
- サーバー側の `PRINTER_API_BEARER_KEY` と一致していない

**解決方法:**
1. サーバー管理者に `PRINTER_API_BEARER_KEY` の値を確認
2. `config.json` の `apiToken` を正しい値に修正
3. アプリを再起動して再テスト

### ❌ ネットワークエラー

**症状:**
- `fetch failed`
- `ENOTFOUND`
- `ETIMEDOUT`

**原因:**
- インターネット接続がない
- サーバーのホスト名 (`apiHost`) が間違っている
- ファイアウォールでブロックされている

**解決方法:**
1. インターネット接続を確認
2. `config.json` の `apiHost` を確認
3. pingでサーバーに到達できるか確認:
   ```bash
   ping tani-hub.sakemaru.click
   ```
4. HTTPSアクセスができるか確認:
   ```bash
   curl -I https://tani-hub.sakemaru.click
   ```

---

## よくある質問

### Q1: 接続テストは毎回実行すべきですか？

**A:** いいえ、以下の場合のみ実行すれば十分です:
- 初期セットアップ時
- 設定変更後
- トラブルシューティング時
- （オプション）アプリ起動時の自動チェック

### Q2: 接続テストが成功してもポーリングが動かない

**A:** 以下を確認してください:
1. ポーリングが開始されているか（ログ確認）
2. サーバー側に印刷待機中のジョブがあるか
3. `warehouse_id` フィルターが正しいか（該当倉庫のジョブがあるか）

### Q3: 接続テストボタンをUIに追加すべきですか？

**A:** 強く推奨します。理由:
- ユーザーが自分で接続確認できる
- トラブルシューティングが容易
- サポート対応の負荷軽減

---

## まとめ

接続テストエンドポイントを活用することで:

✅ サーバーとの通信確認が簡単にできる
✅ トラブルシューティングが迅速になる
✅ ユーザーが自分で問題を診断できる
✅ サポート対応の品質が向上する

**次のステップ:**
1. このガイドに従って接続テスト機能を実装
2. 実際のサーバーでテスト実行
3. エラーハンドリングを確認
4. ユーザードキュメントに使用方法を追記

---

**関連ドキュメント:**
- [API_UPDATE_v2.1_IMPLEMENTATION.md](./API_UPDATE_v2.1_IMPLEMENTATION.md)
- [SAKEMARU_CORE_API_REFERENCE2.md](./SAKEMARU_CORE_API_REFERENCE2.md)
