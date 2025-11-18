# Sakemaru Core API v2.1 実装ガイド

**更新日**: 2025年11月18日
**対象バージョン**: Sakemaru Core API v2.1
**重要度**: 🔴 高（破壊的変更あり）

---

## 📋 目次

1. [変更概要](#変更概要)
2. [必須の実装変更](#必須の実装変更)
3. [新しいAPIエンドポイント](#新しいapiエンドポイント)
4. [環境変数の設定](#環境変数の設定)
5. [実装例](#実装例)
6. [テスト方法](#テスト方法)

---

## 変更概要

### 主要な変更点

1. ✅ **APIフィールド名の変更**
   - `printer_id` → `printer_index` に変更
   - **破壊的変更**: 既存コードの修正が必要

2. ✅ **新しい接続テストエンドポイント追加**
   - `GET /api/printer/test` - サーバー接続確認用

3. ✅ **認証方式の統一**
   - `PRINTER_API_BEARER_KEY` を使用
   - config経由でトークン管理

---

## 必須の実装変更

### 1. フィールド名の変更: `printer_id` → `printer_index`

#### ❌ 変更前（v2.0以前）

```javascript
const job = {
  printer_drivers: {
    printer_id: 1  // ← 旧フィールド名
  }
};

const printerIndex = job.printer_drivers?.printer_id ?? 0;
```

#### ✅ 変更後（v2.1）

```javascript
const job = {
  printer_drivers: {
    printer_index: 1  // ← 新フィールド名
  }
};

const printerIndex = job.printer_drivers?.printer_index ?? 0;
```

#### 修正が必要な箇所

**`renderer.js` または `main.js` のポーリング処理:**

```javascript
// ❌ 修正前
async function processPrintJobs(jobs) {
  for (const job of jobs) {
    const printerId = job.printer_drivers?.printer_id ?? 0;  // ← 修正必要
    const printerName = config[`printer${printerId}`];
    // ...
  }
}

// ✅ 修正後
async function processPrintJobs(jobs) {
  for (const job of jobs) {
    const printerIndex = job.printer_drivers?.printer_index ?? 0;  // ← 修正完了
    const printerName = config[`printer${printerIndex}`];
    // ...
  }
}
```

**プリンタードライバー登録処理（使用している場合）:**

```javascript
// ❌ 修正前
await fetch(`${apiHost}/api/printer/driver`, {
  method: 'POST',
  headers: headers,
  body: JSON.stringify({
    warehouse_id: 1,
    printer_id: 1,  // ← 修正必要
    print_driver_name: 'HP LaserJet Pro'
  })
});

// ✅ 修正後
await fetch(`${apiHost}/api/printer/driver`, {
  method: 'POST',
  headers: headers,
  body: JSON.stringify({
    warehouse_id: 1,
    printer_index: 1,  // ← 修正完了
    print_driver_name: 'HP LaserJet Pro'
  })
});
```

---

## 新しいAPIエンドポイント

### 接続テストエンドポイント

サーバーとの通信が正常に行えるかテストします。

#### エンドポイント

```
GET /api/printer/test
```

#### リクエスト例

```javascript
async function testConnection() {
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
      console.log('✓ Server connection successful');
      console.log('Server info:', result.data);
      return true;
    } else {
      console.error('✗ Connection failed:', response.status);
      return false;
    }
  } catch (error) {
    console.error('✗ Network error:', error.message);
    return false;
  }
}
```

#### レスポンス例

**成功時 (200 OK):**
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

**認証失敗時 (401 Unauthorized):**
```json
{
  "message": "Unauthorized"
}
```

#### 使用例

**1. アプリ起動時の接続確認:**

```javascript
// main.js
app.on('ready', async () => {
  // 設定読み込み
  loadConfig();

  // サーバー接続テスト
  const connected = await testConnection();
  if (!connected) {
    dialog.showErrorBox(
      '接続エラー',
      'サーバーに接続できません。設定を確認してください。'
    );
  }

  // メインウィンドウ作成
  createWindow();
});
```

**2. 設定画面での接続テスト:**

```javascript
// renderer.js
document.getElementById('testConnectionBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('connectionStatus');
  statusEl.textContent = '接続テスト中...';

  const result = await testConnection();

  if (result) {
    statusEl.textContent = '✓ 接続成功';
    statusEl.className = 'success';
  } else {
    statusEl.textContent = '✗ 接続失敗';
    statusEl.className = 'error';
  }
});
```

**3. 定期的なヘルスチェック:**

```javascript
// ポーリング開始前にヘルスチェック
async function startPolling() {
  // 接続確認
  if (!await testConnection()) {
    writeLog('サーバー接続失敗。ポーリングを開始できません。', 'error');
    return;
  }

  // ポーリング開始
  isPolling = true;
  writeLog('ポーリング開始', 'info');
  pollLoop();
}
```

---

## 環境変数の設定

### config.json の設定

```json
{
  "apiHost": "tani-hub.sakemaru.click",
  "apiToken": "your-printer-api-bearer-key-here",
  "pollInterval": 5000,
  "warehouseId": null,
  "printer0": "Default Printer",
  "printer1": "Warehouse A Printer",
  "printer2": "Warehouse B Printer",
  "printer3": "Warehouse C Printer"
}
```

### 重要な設定項目

| 項目 | 説明 | 必須 |
|------|------|------|
| `apiHost` | サーバーのホスト名 | ✓ |
| `apiToken` | `PRINTER_API_BEARER_KEY` の値 | ✓ |
| `pollInterval` | ポーリング間隔（ミリ秒） | ✓ |
| `warehouseId` | 倉庫ID（nullで全倉庫） | - |
| `printer0`～`printer3` | プリンター名 | ✓ |

---

## 実装例

### 完全なポーリング処理（v2.1対応版）

```javascript
// main.js または renderer.js

async function pollTask() {
  try {
    // 1. APIエンドポイント構築
    let apiUrl = `https://${config.apiHost}/api/printer/polling`;
    if (config.warehouseId) {
      apiUrl += `?warehouse_id=${config.warehouseId}`;
    }

    // 2. ポーリングAPIを呼び出し
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    const jobs = result.success && result.data && result.data.data
      ? result.data.data
      : [];

    if (jobs.length > 0) {
      writeLog(`${jobs.length}件の印刷ジョブを取得`, 'info');
    }

    // 3. 各ジョブを処理
    for (const job of jobs) {
      await processPrintJob(job);
    }

  } catch (error) {
    writeLog(`ポーリングエラー: ${error.message}`, 'error');
    console.error('Poll error:', error);
  }
}

async function processPrintJob(job) {
  try {
    // 1. printer_index を取得（v2.1で変更）
    const printerIndex = job.printer_drivers?.printer_index ?? 0;

    // 2. 対応するローカルプリンターを取得
    let printerName = config[`printer${printerIndex}`];

    // フォールバック処理
    if (!printerName && printerIndex !== 0) {
      printerName = config.printer0;
      writeLog(`プリンター${printerIndex}が未設定、デフォルトプリンターを使用`, 'warn');
    }

    if (!printerName) {
      writeLog(`プリンター設定なし: job_id=${job.id}`, 'error');
      return;
    }

    writeLog(`印刷開始: ID=${job.id}, type=${job.print_type}, printer=${printerName}`, 'info');

    // 3. PDFダウンロード
    const localPath = await downloadPDF(job.file_path);

    // 4. 印刷実行
    await printPDF(printerName, localPath);

    // 5. ステータス更新
    const statusUrl = `https://${config.apiHost}/api/printer/document-${job.print_type}-status`;
    await fetch(statusUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: job.id,
        status: 'END'
      })
    });

    writeLog(`印刷完了: ID=${job.id}`, 'success');

    // 6. ローカルファイル削除
    fs.unlinkSync(localPath);

  } catch (error) {
    writeLog(`印刷エラー: ID=${job.id}, error=${error.message}`, 'error');

    // エラー時のステータス更新
    try {
      const statusUrl = `https://${config.apiHost}/api/printer/document-${job.print_type}-status`;
      await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: job.id,
          status: 'FAILURE'
        })
      });
    } catch (statusError) {
      writeLog(`ステータス更新エラー: ${statusError.message}`, 'error');
    }
  }
}
```

---

## テスト方法

### 1. 接続テスト

```bash
# cURLでテスト
curl -X GET "https://tani-hub.sakemaru.click/api/printer/test" \
  -H "Authorization: Bearer YOUR_PRINTER_API_BEARER_KEY" \
  -H "Content-Type: application/json"
```

**期待される結果:**
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

### 2. ポーリングテスト

```bash
# 全倉庫のジョブ取得
curl -X GET "https://tani-hub.sakemaru.click/api/printer/polling" \
  -H "Authorization: Bearer YOUR_PRINTER_API_BEARER_KEY" \
  -H "Content-Type: application/json"

# 特定倉庫のジョブ取得
curl -X GET "https://tani-hub.sakemaru.click/api/printer/polling?warehouse_id=1" \
  -H "Authorization: Bearer YOUR_PRINTER_API_BEARER_KEY" \
  -H "Content-Type: application/json"
```

**レスポンスで確認すべき点:**
- ✅ `printer_drivers.printer_index` フィールドが存在する
- ✅ `printer_drivers.printer_id` フィールドは存在しない（削除済み）

### 3. アプリケーション内でのテスト

**開発者ツールで確認:**

```javascript
// ブラウザの開発者ツールで実行
(async () => {
  // 接続テスト
  const testResult = await testConnection();
  console.log('Connection test:', testResult);

  // ポーリングテスト
  await pollTask();
})();
```

---

## チェックリスト

実装完了前に以下を確認してください:

- [ ] `printer_id` を `printer_index` に変更
- [ ] `testConnection()` 関数を実装
- [ ] 設定画面に接続テストボタンを追加（推奨）
- [ ] アプリ起動時の接続確認を実装（推奨）
- [ ] `config.json` に正しい `apiToken` を設定
- [ ] 実際にサーバーと通信してテスト
- [ ] エラーハンドリングが適切に動作するか確認

---

## トラブルシューティング

### 接続テストが失敗する

**症状:**
```json
{
  "message": "Unauthorized"
}
```

**原因:**
- `apiToken` が正しくない
- サーバー側の `PRINTER_API_BEARER_KEY` と一致していない

**解決方法:**
1. サーバー側の `.env` ファイルで `PRINTER_API_BEARER_KEY` を確認
2. ローカルプリンターの `config.json` の `apiToken` を同じ値に設定
3. アプリを再起動

### ポーリングで printer_index が undefined

**症状:**
```javascript
console.log(job.printer_drivers?.printer_index); // undefined
```

**原因:**
- サーバー側が v2.1 にアップデートされていない
- まだ `printer_id` を返している

**解決方法:**
1. サーバー側のバージョンを確認
2. マイグレーションが実行されているか確認
3. 一時的に後方互換性コードを追加:
```javascript
const printerIndex = job.printer_drivers?.printer_index
                  ?? job.printer_drivers?.printer_id  // フォールバック
                  ?? 0;
```

---

## 参考資料

- [Sakemaru Core API リファレンス v2.0](./SAKEMARU_CORE_API_REFERENCE2.md)
- [UPDATE_GUIDE_v2.1](./UPDATE_GUIDE_v2.1.md)
- [Printer API Guide](../../../sakemaru-ai-core/docs/PRINTER_API_GUIDE.md)

---

**更新履歴:**

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2025-11-18 | 1.0.0 | 初版作成（v2.1対応） |