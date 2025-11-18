# Sakemaru Core API リファレンス v2.0

## 変更履歴

### v2.0.0 (2025-11-18)

#### 主要変更点

1. **HTTPメソッドの変更**
   - `/api/printer/warehouses`: `POST` → `GET/POST`
   - `/api/printer/polling`: `POST` → `GET/POST`
   - クエリパラメータでのリクエストをサポート

2. **倉庫別プリンター印刷機能の追加**
   - 倉庫IDによるジョブフィルタリング
   - サーバー側でprinter_idを管理
   - 倉庫ごとに異なるプリンターで印刷可能

3. **APIクラス名の変更（サーバー側）**
   - より明確で一貫性のある命名規則に変更
   - RESTful原則に準拠

---

## 概要

このドキュメントは、Sakemaru ローカルプリンターシステムが使用するサーバー側APIの仕様を説明します。

**Base URL:** `https://{API_HOST}/api/printer`

**認証:** すべてのエンドポイントは Bearer トークン認証が必要です

```http
Authorization: Bearer {API_TOKEN}
```

---

## エンドポイント一覧

| # | エンドポイント | メソッド | 用途 | 必須度 |
|---|---------------|---------|------|--------|
| 1 | `/api/printer/warehouses` | GET/POST | 倉庫一覧取得 | ◯ |
| 2 | `/api/printer/polling` | GET/POST | 印刷ジョブ取得 | ◎ |
| 3 | `/api/printer/document-slip-status` | POST | 伝票ステータス更新 | ◎ |
| 4 | `/api/printer/document-picking-status` | POST | ピッキングステータス更新 | ◎ |
| 5 | `/api/printer/driver` | POST | プリンタードライバー作成 | △ |

**凡例:**
- ◎ = 必須（印刷フローに不可欠）
- ◯ = 推奨（倉庫別印刷を使用する場合）
- △ = オプション（管理者のみ）

---

## 1. 倉庫一覧取得

倉庫の一覧を取得します。倉庫別プリンター機能を使用する場合に必要です。

### エンドポイント

```
GET /api/printer/warehouses
```

### リクエスト

**Headers:**
```http
Authorization: Bearer {API_TOKEN}
Content-Type: application/json
```

**クエリパラメータ:** なし

**ローカルプリンター実装例:**
```javascript
const apiUrl = `https://${config.apiHost}/api/printer/warehouses`;
const response = await fetch(apiUrl, {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiToken}`
  }
});

const result = await response.json();
const warehouses = result.success && result.data && result.data.data
  ? result.data.data
  : [];
```

### レスポンス

**Success (200):**
```json
{
  "success": true,
  "data": {
    "current_page": 1,
    "data": [
      {
        "id": 1,
        "code": 1001,
        "name": "東京倉庫"
      },
      {
        "id": 2,
        "code": 1002,
        "name": "大阪倉庫"
      },
      {
        "id": 3,
        "code": 1003,
        "name": "福岡倉庫"
      }
    ],
    "per_page": 10,
    "total": 3
  }
}
```

### ローカルプリンターでの使用方法

1. 設定画面の「倉庫一覧を読み込み」ボタンで呼び出す
2. 取得した倉庫をドロップダウンに表示
3. ユーザーが倉庫を選択（または「全倉庫」のまま）
4. 選択した倉庫IDを`config.warehouseId`に保存

---

## 2. 印刷ジョブ取得（ポーリング）

印刷待機中のジョブを取得します。**最も重要なエンドポイント**です。

### エンドポイント

```
GET /api/printer/polling
```

または倉庫を指定する場合:

```
GET /api/printer/polling?warehouse_id=1
```

### リクエスト

**Headers:**
```http
Authorization: Bearer {API_TOKEN}
Content-Type: application/json
```

**クエリパラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| warehouse_id | integer | - | 倉庫ID（指定した倉庫のジョブのみ取得） |

**ローカルプリンター実装例:**
```javascript
// APIエンドポイントを構築
let apiUrl = `https://${config.apiHost}/api/printer/polling`;

// warehouse_idが設定されている場合はクエリパラメータとして追加
if (config.warehouseId) {
  apiUrl += `?warehouse_id=${parseInt(config.warehouseId)}`;
}

const response = await fetch(apiUrl, {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiToken}`
  }
});

const result = await response.json();
const jobs = result.success && result.data && result.data.data
  ? result.data.data
  : [];
```

### レスポンス

**Success (200):**
```json
{
  "success": true,
  "data": {
    "current_page": 1,
    "data": [
      {
        "print_type": "slip",
        "id": 123,
        "client_id": 1,
        "log_pdf_export_id": 456,
        "creator_id": 10,
        "creator_user": {
          "id": 10,
          "name": "山田太郎",
          "email": "yamada@example.com"
        },
        "printer_driver_id": 5,
        "printer_drivers": {
          "print_driver_name": "HP LaserJet Pro",
          "warehouse_id": 1,
          "printer_id": 1,
          "warehouse": {
            "id": 1,
            "code": 1001,
            "name": "東京倉庫"
          }
        },
        "file_path": "exports/slip_20250118_123456.pdf",
        "file_type": "S3",
        "status": "STANDBY",
        "created_at": "2025-01-18 10:30:00",
        "updated_at": "2025-01-18 10:30:00"
      },
      {
        "print_type": "picking",
        "id": 124,
        "client_id": 1,
        "log_pdf_export_id": 457,
        "creator_id": 10,
        "creator_user": {
          "id": 10,
          "name": "山田太郎",
          "email": "yamada@example.com"
        },
        "printer_driver_id": 5,
        "printer_drivers": {
          "print_driver_name": "HP LaserJet Pro",
          "warehouse_id": 1,
          "printer_id": 1,
          "warehouse": {
            "id": 1,
            "code": 1001,
            "name": "東京倉庫"
          }
        },
        "file_path": "exports/picking_20250118_123457.pdf",
        "file_type": "S3",
        "status": "STANDBY",
        "created_at": "2025-01-18 10:31:00",
        "updated_at": "2025-01-18 10:31:00"
      }
    ],
    "per_page": 10,
    "total": 2
  }
}
```

### レスポンスフィールド詳細

| フィールド | 型 | 説明 | ローカルでの使用 |
|-----------|---|------|-----------------|
| `print_type` | string | 印刷タイプ（`slip`=伝票、`picking`=ピッキングリスト） | ステータス更新APIのURL決定に使用 |
| `id` | integer | 印刷ジョブID | ステータス更新時に必須 |
| `file_path` | string | S3のファイルパス | PDFダウンロードに使用 |
| `printer_drivers.printer_id` | integer | **ローカルプリンター番号（0-3）** | **どのプリンターで印刷するか決定** |
| `printer_drivers.warehouse_id` | integer | 倉庫ID | ログ出力用 |
| `status` | string | ジョブステータス | `STANDBY`のみ取得される |

### ローカルプリンターでの処理フロー

```javascript
// 1. APIレスポンスを内部形式に変換
const jobs = data.map(item => ({
  file_id: item.id,
  print_type: item.print_type,
  file_url: item.file_path,
  printer_id: item.printer_drivers?.printer_id ?? 0, // ★重要★
  warehouse_id: item.printer_drivers?.warehouse_id,
  order: item.id
}));

// 2. ID順にソート
const sortedJobs = [...jobs].sort((a, b) => a.order - b.order);

// 3. 並列ダウンロード
const downloadedJobs = await downloadFilesInParallel(sortedJobs);

// 4. 順番に印刷
for (const job of downloadedJobs) {
  // printer_idに対応するローカルプリンターを取得
  const printerNum = Number(job.printer_id);
  let printerName = config[`printer${printerNum}`];

  // フォールバック（プリンターが未設定の場合）
  if (!printerName && printerNum !== 0) {
    printerName = config.printer0;
    writeLog(`プリンタ${printerNum}が未設定、プリンタ0にフォールバック`, 'info');
  }

  // 印刷実行
  if (printerName) {
    writeLog(`印刷開始: ID=${job.file_id}, type=${job.print_type}, warehouse=${job.warehouse_id}, printer=${printerName}`, 'info');
    await printPdf(printerName, job.localPath);
    fs.unlinkSync(job.localPath);

    // ★ステータス更新（重要）★
    const statusUpdateUrl = `https://${config.apiHost}/api/printer/document-${job.print_type}-status`;
    await fetch(statusUpdateUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ id: job.file_id, status: 'END' })
    });

    writeLog(`印刷完了: ID=${job.file_id}`, 'success');
  }
}
```

---

## 3. 伝票印刷ステータス更新

伝票印刷ジョブのステータスを更新します。**印刷完了後に必ず呼び出す必要があります。**

### エンドポイント

```
POST /api/printer/document-slip-status
```

### リクエスト

**Headers:**
```http
Authorization: Bearer {API_TOKEN}
Content-Type: application/json
```

**Body:**
```json
{
  "id": 123,
  "status": "END"
}
```

**パラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| id | integer | ✓ | 印刷ジョブID（ポーリングAPIで取得した`id`） |
| status | string | ✓ | ステータス値 |

**ステータス値:**

| 値 | 説明 | 使用タイミング |
|----|------|---------------|
| `START` | 印刷開始 | （オプション）印刷処理開始時 |
| `END` | 印刷完了 | **必須** - 印刷完了時 |
| `FAILURE` | 印刷失敗 | 印刷エラー時 |

**ローカルプリンター実装例:**
```javascript
const statusUpdateUrl = `https://${config.apiHost}/api/printer/document-slip-status`;
try {
  await fetch(statusUpdateUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiToken}`
    },
    body: JSON.stringify({
      id: job.file_id,
      status: 'END'
    })
  });
  writeLog(`ステータス更新完了: ID=${job.file_id}`, 'info');
} catch (err) {
  writeLog(`ステータス更新失敗: ID=${job.file_id}, error=${err.message}`, 'error');
}
```

### レスポンス

**Success (200):**
```json
{
  "success": true,
  "message": "ステータスが更新されました"
}
```

### 重要な注意事項

**ステータス更新を忘れると:**
- 印刷ジョブが永遠に`STANDBY`状態のまま残る
- 次回のポーリングで同じジョブが再度返される
- **同じ伝票が何度も印刷される**

**必ず印刷完了後に`status: "END"`を送信してください。**

---

## 4. ピッキングリスト印刷ステータス更新

ピッキングリスト印刷ジョブのステータスを更新します。

### エンドポイント

```
POST /api/printer/document-picking-status
```

### リクエスト・レスポンス

伝票印刷ステータス更新（エンドポイント3）と同じです。

### print_typeによる自動判定

ローカルプリンターシステムでは、`print_type`に基づいて自動的にエンドポイントを選択します：

```javascript
// print_typeに応じてエンドポイントを決定
const statusUpdateUrl = `https://${config.apiHost}/api/printer/document-${job.print_type}-status`;

// job.print_type === "slip" の場合
// → https://{API_HOST}/api/printer/document-slip-status

// job.print_type === "picking" の場合
// → https://{API_HOST}/api/printer/document-picking-status
```

---

## 5. プリンタードライバー作成（管理者向け）

新しいプリンタードライバーを登録します。**通常、ローカルプリンターシステムから呼び出す必要はありません。**

### エンドポイント

```
POST /api/printer/driver
```

### リクエスト

**Headers:**
```http
Authorization: Bearer {API_TOKEN}
Content-Type: application/json
```

**Body:**
```json
{
  "warehouse_id": 1,
  "printer_id": 1,
  "print_driver_name": "HP LaserJet Pro MFP M428fdw"
}
```

**パラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| warehouse_id | integer | ✓ | 倉庫ID |
| printer_id | integer | - | ローカルプリンター番号（0-3、デフォルト: 0） |
| print_driver_name | string | ✓ | プリンタードライバー名 |

**printer_id説明:**
- `0`: ローカルシステムの`printer0`（デフォルトプリンター）
- `1`: ローカルシステムの`printer1`
- `2`: ローカルシステムの`printer2`
- `3`: ローカルシステムの`printer3`

### レスポンス

**Success (200):**
```json
{
  "success": true,
  "message": "プリンタードライバーが登録されました"
}
```

### 使用例（管理者向け）

```bash
# 東京倉庫（ID: 1）の伝票を、ローカルシステムのprinter1で印刷
curl -X POST "https://tani-hub.sakemaru.click/api/printer/driver" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "warehouse_id": 1,
    "printer_id": 1,
    "print_driver_name": "Tokyo Warehouse Printer"
  }'

# 大阪倉庫（ID: 2）の伝票を、ローカルシステムのprinter2で印刷
curl -X POST "https://tani-hub.sakemaru.click/api/printer/driver" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "warehouse_id": 2,
    "printer_id": 2,
    "print_driver_name": "Osaka Warehouse Printer"
  }'
```

---

## エラーレスポンス

すべてのエンドポイントで、エラー時は以下の形式でレスポンスが返されます。

### Unauthorized (401)

認証トークンが無効または未設定の場合：

```json
{
  "success": false,
  "message": "Unauthorized"
}
```

**対処法:**
- `.env`ファイルの`PRINTER_API_BEARER_KEY`を確認
- ローカルプリンターの設定画面でAPIトークンを確認

### Validation Error (422)

リクエストパラメータが不正な場合：

```json
{
  "success": false,
  "message": "Validation Error",
  "errors": {
    "warehouse_id": ["倉庫IDは必須です"],
    "status": ["ステータスは必須です"]
  }
}
```

**対処法:**
- リクエストパラメータを確認
- 必須フィールドが含まれているか確認

### Server Error (500)

サーバー側でエラーが発生した場合：

```json
{
  "success": false,
  "message": "Internal Server Error"
}
```

**対処法:**
- サーバーログを確認
- 一時的なエラーの可能性があるため、リトライを試す

---

## ローカルプリンターシステム実装ガイド

### 基本的なポーリングループ

```javascript
async function pollLoop() {
  if (!isPolling) return;

  try {
    await pollTask();
  } catch (err) {
    writeLog(`ポーリングエラー: ${err.message}`, 'error');
    console.error('Poll loop error:', err);
  }

  // 次のポーリングをスケジュール
  if (isPolling) {
    pollingTimer = setTimeout(pollLoop, config.pollInterval);
  }
}

async function pollTask() {
  // 1. APIエンドポイントを構築
  let apiUrl = `https://${config.apiHost}/api/printer/polling`;
  if (config.warehouseId) {
    apiUrl += `?warehouse_id=${parseInt(config.warehouseId)}`;
  }

  // 2. ポーリングAPIを呼び出し
  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiToken}`
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const response = await res.json();
  const data = response.success && response.data && response.data.data
    ? response.data.data
    : [];

  if (data && Array.isArray(data) && data.length > 0) {
    // 3. ジョブを内部形式に変換
    const jobs = data.map(item => ({
      file_id: item.id,
      print_type: item.print_type,
      file_url: item.file_path,
      printer_id: item.printer_drivers?.printer_id ?? 0,
      warehouse_id: item.printer_drivers?.warehouse_id,
      order: item.id
    }));

    // 4. ソート
    const sortedJobs = [...jobs].sort((a, b) => a.order - b.order);

    // 5. ダウンロード
    const downloadedJobs = await downloadFilesInParallel(sortedJobs);

    // 6. 印刷
    for (const job of downloadedJobs) {
      if (!job.success) continue;

      const printerNum = Number(job.printer_id);
      let printerName = config[`printer${printerNum}`];

      if (!printerName && printerNum !== 0) {
        printerName = config.printer0;
      }

      if (printerName) {
        await printPdf(printerName, job.localPath);
        fs.unlinkSync(job.localPath);

        // 7. ステータス更新
        const statusUrl = `https://${config.apiHost}/api/printer/document-${job.print_type}-status`;
        await fetch(statusUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiToken}`
          },
          body: JSON.stringify({ id: job.file_id, status: 'END' })
        });
      }
    }
  }
}
```

### エラーハンドリング

```javascript
async function pollTask() {
  try {
    // ... polling logic
  } catch (err) {
    // ネットワークエラー
    if (err.message.includes('fetch failed') || err.message.includes('ENOTFOUND')) {
      writeLog('ネットワークエラー: サーバーに接続できません', 'error');
    }
    // 認証エラー
    else if (err.message.includes('401')) {
      writeLog('認証エラー: APIトークンを確認してください', 'error');
    }
    // その他のエラー
    else {
      writeLog(`エラー: ${err.message}`, 'error');
    }

    throw err; // 上位でリトライ処理を実行
  }
}
```

### 推奨設定

| 設定項目 | 推奨値 | 説明 |
|---------|--------|------|
| ポーリング間隔 | 5000ms (5秒) | サーバー負荷とリアルタイム性のバランス |
| リトライ回数 | 3回 | 一時的なネットワークエラーに対応 |
| タイムアウト | 30秒 | PDFダウンロードを考慮 |
| 並列ダウンロード数 | 4 | ネットワーク帯域とメモリのバランス |

---

## 移行ガイド（v1.x → v2.0）

### 破壊的変更

1. **HTTPメソッドの変更**
   - ローカルプリンターシステムでGETメソッドに変更
   - サーバー側は互換性のためGET/POST両方をサポート

2. **レスポンス構造の拡張**
   - `printer_drivers`オブジェクトに`printer_id`が追加
   - 既存のフィールドはそのまま維持

### 移行手順

1. **サーバー側の更新**
   ```bash
   cd /path/to/sakemaru-ai-core
   git pull
   php artisan migrate
   ```

2. **ローカルプリンター側の更新**
   ```bash
   cd /path/to/sakemaru-local-printer
   git pull
   npm install
   # アプリを再起動
   ```

3. **設定の確認**
   - 設定ファイルに`warehouseId`フィールドが追加されます
   - 既存の設定は自動的に維持されます

4. **倉庫とプリンターの紐付け（オプション）**
   - サーバー側で倉庫ごとにprinter_idを設定
   - ローカルプリンターで倉庫を選択（または全倉庫のまま）

### 互換性

- v1.xの設定ファイルは自動的に移行されます
- `warehouse_id`未指定の場合、全倉庫のジョブを取得（v1.x互換）
- `printer_id`が未設定のジョブは、`printer0`で印刷されます

---

## よくある質問（FAQ）

### Q1: 倉庫IDを指定しない場合、どうなりますか？

**A:** すべての倉庫の印刷ジョブが取得されます（v1.x互換動作）。

### Q2: printer_idが設定されていないジョブはどうなりますか？

**A:** `printer0`（デフォルトプリンター）で印刷されます。

### Q3: 複数の倉庫を同時に監視できますか？

**A:** ローカルプリンターシステムでは1つの倉庫を指定するか、全倉庫を監視するかのどちらかです。複数の特定倉庫を選択することはできません。

### Q4: ステータス更新に失敗した場合、どうなりますか？

**A:** 印刷ジョブは`STANDBY`状態のままなので、次回のポーリングで再度取得されます。ステータス更新のリトライ処理を実装することを推奨します。

### Q5: GETメソッドとPOSTメソッドのどちらを使うべきですか？

**A:** GETメソッドを推奨します（RESTful原則に準拠）。POSTメソッドは後方互換性のためにサポートされています。

---

## サポート

問題が発生した場合は、以下の情報とともにサポートに連絡してください：

1. エラーメッセージのスクリーンショット
2. ログファイル（`logs/`ディレクトリ内）
3. 設定内容（トークンは除く）
4. サーバー側のバージョン
5. ローカルプリンターのバージョン
