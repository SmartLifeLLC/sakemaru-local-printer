# Sakemaru プリンターシステム API リファレンス

## 概要

このドキュメントは、Sakemaruローカルプリンターシステムが使用するサーバー側APIの仕様を説明します。

**Base URL:** `https://{API_HOST}/api/printer`

**認証:** すべてのエンドポイントは Bearer トークン認証が必要です

```http
Authorization: Bearer {API_TOKEN}
```

---

## エンドポイント一覧

1. [GET 倉庫一覧](#1-get-倉庫一覧)
2. [GET 印刷ジョブ取得（ポーリング）](#2-get-印刷ジョブ取得ポーリング)
3. [POST 伝票印刷ステータス更新](#3-post-伝票印刷ステータス更新)
4. [POST ピッキングリスト印刷ステータス更新](#4-post-ピッキングリスト印刷ステータス更新)
5. [POST プリンタードライバー登録](#5-post-プリンタードライバー登録管理者向け)

---

## 1. GET 倉庫一覧

クライアントに紐づく倉庫の一覧を取得します。

### エンドポイント
```
POST /api/printer/warehouses
```

### リクエスト

**Headers:**
```http
Authorization: Bearer {API_TOKEN}
Content-Type: application/json
```

**Body:**
```json
{}
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
      }
    ],
    "per_page": 10,
    "total": 2
  }
}
```

**フィールド説明:**
- `id`: 倉庫ID
- `code`: 倉庫コード
- `name`: 倉庫名

---

## 2. GET 印刷ジョブ取得（ポーリング）

印刷待機中のジョブを取得します。

### エンドポイント
```
POST /api/printer/polling
```

### リクエスト

**Headers:**
```http
Authorization: Bearer {API_TOKEN}
Content-Type: application/json
```

**Body (全倉庫のジョブを取得):**
```json
{}
```

**Body (特定倉庫のジョブのみ取得):**
```json
{
  "warehouse_id": 1
}
```

**パラメータ:**
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| warehouse_id | integer | - | 倉庫ID（指定すると、その倉庫のジョブのみ取得） |

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

**主要フィールド:**
- `print_type`: 印刷タイプ（`slip`=伝票、`picking`=ピッキングリスト）
- `id`: 印刷ジョブID
- `file_path`: S3のファイルパス
- `printer_drivers.printer_id`: **ローカルプリンター番号（0-3）**
- `printer_drivers.warehouse_id`: 倉庫ID
- `status`: ジョブステータス（`STANDBY`=待機中）

**ローカルシステムでの処理:**
1. `printer_drivers.printer_id`を取得
2. 対応するローカルプリンター（`printer0`〜`printer3`）で印刷
3. 印刷完了後、ステータス更新APIを呼び出す

---

## 3. POST 伝票印刷ステータス更新

伝票印刷ジョブのステータスを更新します。

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
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| id | integer | ✓ | 印刷ジョブID |
| status | string | ✓ | ステータス（`START`, `END`, `FAILURE`） |

**ステータス値:**
- `START`: 印刷開始
- `END`: 印刷完了
- `FAILURE`: 印刷失敗

### レスポンス

**Success (200):**
```json
{
  "success": true,
  "message": "ステータスが更新されました"
}
```

---

## 4. POST ピッキングリスト印刷ステータス更新

ピッキングリスト印刷ジョブのステータスを更新します。

### エンドポイント
```
POST /api/printer/document-picking-status
```

### リクエスト・レスポンス

[伝票印刷ステータス更新](#3-post-伝票印刷ステータス更新)と同じ

---

## 5. POST プリンタードライバー登録（管理者向け）

新しいプリンタードライバーを登録します。

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
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
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

---

## エラーレスポンス

すべてのエンドポイントで、エラー時は以下の形式でレスポンスが返されます：

**Unauthorized (401):**
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

**Validation Error (422):**
```json
{
  "success": false,
  "message": "Validation Error",
  "errors": {
    "warehouse_id": ["倉庫IDは必須です"]
  }
}
```

**Server Error (500):**
```json
{
  "success": false,
  "message": "Internal Server Error"
}
```

---

## ローカルシステム実装例

### 基本的なポーリング処理

```javascript
async function pollPrintJobs() {
  const apiUrl = `https://${config.apiHost}/api/printer/polling`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiToken}`
  };

  const requestBody = {};
  if (config.warehouseId) {
    requestBody.warehouse_id = parseInt(config.warehouseId);
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(requestBody)
  });

  const result = await response.json();
  const jobs = result.success && result.data && result.data.data ? result.data.data : [];

  for (const job of jobs) {
    await processPrintJob(job);
  }
}

async function processPrintJob(job) {
  // 1. printer_idを取得
  const printerId = job.printer_drivers?.printer_id ?? 0;
  const printerName = config[`printer${printerId}`];

  // 2. PDFをダウンロード
  const localPath = await downloadPDF(job.file_path);

  // 3. 印刷
  await printPDF(printerName, localPath);

  // 4. ステータス更新
  const statusUrl = `https://${config.apiHost}/api/printer/document-${job.print_type}-status`;
  await fetch(statusUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiToken}`
    },
    body: JSON.stringify({
      id: job.id,
      status: 'END'
    })
  });
}
```

---

## 運用上の注意事項

### ポーリング間隔

- 推奨: 5秒〜10秒
- サーバー負荷を考慮して設定してください

### リトライ処理

- ネットワークエラー時は、適切にリトライしてください
- エクスポネンシャルバックオフを推奨

### ログ記録

- すべてのAPI呼び出しをログに記録してください
- エラー発生時のデバッグに役立ちます

### セキュリティ

- APIトークンは安全に保管してください
- HTTPS通信のみを使用してください
