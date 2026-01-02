# プリンタルーティングシステム設計書

## 1. システム概要

### 1.1 目的

- サーバーからAPIでプリンタを指定して印刷
- 倉庫別・配送コース別の自動印刷
- 専用伝票プリンタの対応

### 1.2 アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────┐
│                         サーバー                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ プリンタ     │  │ 印刷ルーティ │  │ 印刷ジョブ   │                 │
│  │ 管理        │  │ ング        │  │ 管理        │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
│         ▲                                   │                       │
│         │                                   ▼                       │
│  ┌──────┴──────────────────────────────────────┐                   │
│  │              印刷ジョブキュー                 │                   │
│  └──────────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ API
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ローカルプリンタクライアント                       │
├─────────────────────────────────────────────────────────────────────┤
│  1. 倉庫選択                                                        │
│  2. プリンタリスト同期（サーバーへ送信）                              │
│  3. 印刷ジョブ取得（ポーリング）                                      │
│  4. 指定プリンタで印刷                                               │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 データフロー

```
[初期設定]
クライアント                         サーバー
    │                                   │
    │ 1. 認証（トークン取得）            │
    │ ─────────────────────────────────→ │
    │ ←───────────────────────────────── │
    │                                   │
    │ 2. 倉庫一覧取得                    │
    │ ─────────────────────────────────→ │
    │ ←───────────────────────────────── │
    │                                   │
    │ 3. 倉庫選択 & プリンタリスト同期    │
    │ ─────────────────────────────────→ │
    │                                   │ DBに保存
    │ ←───────────────────────────────── │
    │                                   │

[通常運用]
クライアント                         サーバー
    │                                   │
    │ 4. 印刷ジョブ取得（ポーリング）     │
    │ ─────────────────────────────────→ │
    │                                   │ ルーティング判定
    │ ←───────────────────────────────── │ (printer_driver_id指定)
    │                                   │
    │ 5. 指定プリンタで印刷              │
    │   (ローカル処理)                   │
    │                                   │
    │ 6. 印刷完了報告                    │
    │ ─────────────────────────────────→ │
    │ ←───────────────────────────────── │
```

---

## 2. データベース設計

### 2.1 テーブル一覧

| テーブル名 | 用途 | 状態 |
|------------|------|------|
| `client_printer_drivers` | 倉庫別プリンタ | **既存** |
| `slip_types` | 専用伝票タイプマスタ | **既存** |
| `client_printer_slip_type_printers` | 専用伝票の使用可能プリンタ | **新規** |
| `client_printer_course_settings` | 配送コース別プリンタ設定 | **新規** |

### 2.2 ER図

```
warehouses (既存)
    │
    │ 1:N
    ▼
client_printer_drivers (既存)
    │ ├── id
    │ ├── client_id
    │ ├── warehouse_id
    │ ├── printer_index (0-3)
    │ ├── name (プリンタ名)
    │ └── is_active
    │
    ├───────────────────────────────┐
    │                               │
    ▼                               ▼
client_printer_slip_type_printers   client_printer_course_settings
├── slip_type_id                    ├── warehouse_id
├── printer_driver_id ──────────┐   ├── delivery_course_id
├── is_default                  │   └── printer_driver_id ─────────┐
└── is_active                   │                                   │
                                │                                   │
slip_types (既存) ◄─────────────┘                                   │
├── id                                                              │
├── client_id                                                       │
├── code                       client_printer_drivers ◄─────────────┘
└── name
```

### 2.3 既存テーブル: client_printer_drivers

```sql
CREATE TABLE client_printer_drivers (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code            BIGINT UNSIGNED              NULL COMMENT 'コード',
    client_id       BIGINT UNSIGNED              NOT NULL COMMENT '顧客ID',
    creator_id      BIGINT UNSIGNED              NULL COMMENT '作成者ID',
    last_updater_id BIGINT UNSIGNED              NULL COMMENT '最終更新者ID',
    warehouse_id    BIGINT UNSIGNED              NOT NULL COMMENT '倉庫ID',
    printer_index   TINYINT UNSIGNED DEFAULT '0' NULL COMMENT 'ローカルプリンター番号（0-3）',
    name            VARCHAR(50)                  NULL COMMENT 'プリンタードライバー名',
    is_active       TINYINT(1)       DEFAULT 1   NOT NULL COMMENT '有効フラグ',
    created_at      TIMESTAMP                    NULL,
    updated_at      TIMESTAMP                    NULL,

    UNIQUE KEY client_printer_drivers_warehouse_printer_unique (warehouse_id, printer_index),
    FOREIGN KEY (creator_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (last_updater_id) REFERENCES users (id) ON DELETE SET NULL
) COLLATE = utf8mb4_unicode_ci;
```

### 2.4 既存テーブル: slip_types

```sql
CREATE TABLE slip_types (
    id                            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id                     BIGINT UNSIGNED      NOT NULL,
    code                          INT                  NOT NULL,
    name                          VARCHAR(255)         NOT NULL,
    is_active                     TINYINT(1)           NOT NULL,
    creator_id                    BIGINT UNSIGNED      NOT NULL,
    last_updater_id               BIGINT UNSIGNED      NOT NULL COMMENT '最終更新者id',
    is_created_from_data_transfer TINYINT(1) DEFAULT 0 NOT NULL,
    created_at                    TIMESTAMP            NULL,
    updated_at                    TIMESTAMP            NULL
) COLLATE = utf8mb4_unicode_ci;
```

### 2.5 新規テーブル: client_printer_slip_type_printers

専用伝票タイプごとに使用可能なプリンタを設定する中間テーブル。

```sql
CREATE TABLE client_printer_slip_type_printers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id BIGINT UNSIGNED NOT NULL COMMENT '顧客ID',
    slip_type_id BIGINT UNSIGNED NOT NULL COMMENT '伝票タイプID',
    printer_driver_id BIGINT UNSIGNED NOT NULL COMMENT 'プリンタID',
    is_default TINYINT(1) DEFAULT 0 NOT NULL COMMENT 'デフォルトプリンタ',
    creator_id BIGINT UNSIGNED NULL,
    last_updater_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) DEFAULT 1 NOT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL,

    UNIQUE KEY unique_slip_type_printer (slip_type_id, printer_driver_id),
    FOREIGN KEY (slip_type_id) REFERENCES slip_types(id) ON DELETE CASCADE,
    FOREIGN KEY (printer_driver_id) REFERENCES client_printer_drivers(id) ON DELETE CASCADE,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (last_updater_id) REFERENCES users(id) ON DELETE SET NULL
) COLLATE = utf8mb4_unicode_ci;
```

### 2.6 新規テーブル: client_printer_course_settings

配送コースごとにプリンタを設定するテーブル。

```sql
CREATE TABLE client_printer_course_settings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id BIGINT UNSIGNED NOT NULL COMMENT '顧客ID',
    warehouse_id BIGINT UNSIGNED NOT NULL COMMENT '倉庫ID',
    delivery_course_id BIGINT UNSIGNED NOT NULL COMMENT '配送コースID',
    printer_driver_id BIGINT UNSIGNED NOT NULL COMMENT 'プリンタID',
    creator_id BIGINT UNSIGNED NULL,
    last_updater_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) DEFAULT 1 NOT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL,

    UNIQUE KEY unique_warehouse_course (warehouse_id, delivery_course_id),
    FOREIGN KEY (printer_driver_id) REFERENCES client_printer_drivers(id) ON DELETE CASCADE,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (last_updater_id) REFERENCES users(id) ON DELETE SET NULL
) COLLATE = utf8mb4_unicode_ci;
```

---

## 3. 印刷ルーティングロジック

### 3.1 優先順位

| 優先度 | 条件 | プリンタ決定元 |
|--------|------|----------------|
| 1 | 専用伝票 (`buyer_details.slip_type_id` あり) | `client_printer_slip_type_printers` |
| 2 | 配送コース設定あり | `client_printer_course_settings` |
| 3 | 上記以外 | `client_printer_drivers` (倉庫デフォルト) |

### 3.2 フローチャート

```
┌─────────────────────────────────────────────────────────────┐
│                    印刷ジョブ発生                            │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. 専用伝票の得意先か？ (buyer_details.slip_type_id)         │
├─────────────────────────────────────────────────────────────┤
│    YES → client_printer_slip_type_printers から             │
│          使用可能なプリンタを選択して指定                    │
└─────────────────────────┬───────────────────────────────────┘
                          │ NO
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. 配送コース別プリンタ設定あり？                            │
│    (client_printer_course_settings)                         │
├─────────────────────────────────────────────────────────────┤
│    YES → そのプリンタを指定                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │ NO
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. 倉庫デフォルトプリンタを指定                              │
│    (client_printer_drivers)                                 │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 実装例（PHP）

```php
function determinePrinter($printJob) {
    $warehouseId = $printJob->warehouse_id;
    $buyerId = $printJob->buyer_id;
    $deliveryCourseId = $printJob->delivery_course_id;

    // 得意先の伝票タイプを取得
    $slipTypeId = BuyerDetail::where('buyer_id', $buyerId)->value('slip_type_id');

    // 1. 専用伝票の場合
    if ($slipTypeId) {
        $printer = ClientPrinterSlipTypePrinter::query()
            ->where('slip_type_id', $slipTypeId)
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->first();

        if ($printer) {
            return [
                'printer_driver_id' => $printer->printer_driver_id,
                'routing_type' => 'dedicated_slip'
            ];
        }
    }

    // 2. 配送コース別
    if ($deliveryCourseId) {
        $courseSetting = ClientPrinterCourseSetting::query()
            ->where('warehouse_id', $warehouseId)
            ->where('delivery_course_id', $deliveryCourseId)
            ->where('is_active', true)
            ->first();

        if ($courseSetting) {
            return [
                'printer_driver_id' => $courseSetting->printer_driver_id,
                'routing_type' => 'course'
            ];
        }
    }

    // 3. 倉庫デフォルト
    $defaultPrinter = ClientPrinterDriver::query()
        ->where('warehouse_id', $warehouseId)
        ->where('printer_index', 0)
        ->where('is_active', true)
        ->first();

    return [
        'printer_driver_id' => $defaultPrinter?->id,
        'routing_type' => 'default'
    ];
}
```

---

## 4. API一覧

### 4.0 共通ヘッダー

すべてのAPIリクエストに以下のヘッダーを含める：

| ヘッダー | 必須 | 説明 |
|----------|------|------|
| `Authorization` | ○ | `Bearer {token}` 形式の認証トークン |
| `Content-Type` | ○ | `application/json` |
| `X-Client-Id` | ○ | クライアント固有のUUID（初回起動時に自動生成、永続化） |

#### X-Client-Id について

- 各プリンタクライアントを一意に識別するためのUUID
- 初回起動時に `crypto.randomUUID()` で自動生成
- `config.json` の `clientId` フィールドに永続化
- 同一PCでも再インストール時は新しいUUIDが生成される
- サーバー側で以下の用途に使用：
  - クライアント識別・追跡
  - 印刷ログの紐付け
  - 重複リクエストの検知
  - デバッグ・トラブルシューティング

**リクエスト例：**
```
GET /api/printer/polling?warehouse_id=1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
X-Client-Id: 550e8400-e29b-41d4-a716-446655440000
```

### 4.1 クライアント向けAPI

| # | メソッド | エンドポイント | 用途 |
|---|----------|----------------|------|
| 1 | GET | `/api/printer/test` | 接続テスト |
| 2 | GET | `/api/printer/warehouses` | 倉庫一覧取得 |
| 3 | GET | `/api/printer/warehouses/{id}/printers` | 倉庫のプリンタ一覧取得 |
| 4 | POST | `/api/printer/warehouses/{id}/printers/sync` | プリンタリスト同期 |
| 5 | GET | `/api/printer/polling` | 印刷ジョブ取得 |
| 6 | POST | `/api/printer/jobs/{id}/complete` | 印刷完了報告 |

### 4.2 管理画面向けAPI

| # | メソッド | エンドポイント | 用途 |
|---|----------|----------------|------|
| 7 | GET | `/api/admin/client-printer-drivers` | プリンタ一覧 |
| 8 | GET | `/api/admin/slip-types` | 専用伝票タイプ一覧 |
| 9 | GET | `/api/admin/client-printer-slip-type-printers` | 専用伝票プリンタ設定一覧 |
| 10 | PUT | `/api/admin/client-printer-slip-type-printers/{slip_type_id}` | 専用伝票プリンタ設定更新 |
| 11 | GET | `/api/admin/delivery-courses` | 配送コース一覧 |
| 12 | GET | `/api/admin/client-printer-course-settings` | コース別設定一覧 |
| 13 | POST | `/api/admin/client-printer-course-settings` | コース別設定追加 |
| 14 | PUT | `/api/admin/client-printer-course-settings/{id}` | コース別設定更新 |
| 15 | DELETE | `/api/admin/client-printer-course-settings/{id}` | コース別設定削除 |

---

## 5. API詳細仕様

### 5.1 接続テスト

```
GET /api/printer/test
Authorization: Bearer {token}
X-Client-Id: {client_uuid}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "server_version": "2.1.0",
    "client_id": 1,
    "timestamp": "2026-01-02T10:00:00Z"
  }
}
```

---

### 5.2 倉庫一覧取得

```
GET /api/printer/warehouses
Authorization: Bearer {token}
```

**レスポンス:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "WH001",
      "name": "倉庫A",
      "is_active": true
    },
    {
      "id": 2,
      "code": "WH002",
      "name": "倉庫B",
      "is_active": true
    }
  ]
}
```

---

### 5.3 倉庫のプリンタ一覧取得

```
GET /api/printer/warehouses/{warehouse_id}/printers
Authorization: Bearer {token}
```

**レスポンス:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "printer_index": 0,
      "name": "Kyocera_ECOSYS",
      "is_active": true,
      "last_synced_at": "2026-01-02T09:00:00Z"
    },
    {
      "id": 2,
      "printer_index": 1,
      "name": "Brother_QL-820",
      "is_active": true,
      "last_synced_at": "2026-01-02T09:00:00Z"
    }
  ]
}
```

---

### 5.4 プリンタリスト同期

```
POST /api/printer/warehouses/{warehouse_id}/printers/sync
Authorization: Bearer {token}
Content-Type: application/json
X-Client-Id: {client_uuid}
```

**リクエスト:**
```json
{
  "printers": [
    {
      "printer_index": 0,
      "name": "Kyocera_ECOSYS",
      "is_default": true
    },
    {
      "printer_index": 1,
      "name": "Brother_QL-820",
      "is_default": false
    },
    {
      "printer_index": 2,
      "name": "EPSON_TM-T88",
      "is_default": false
    }
  ]
}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "synced_count": 3,
    "printers": [
      {
        "id": 1,
        "printer_index": 0,
        "name": "Kyocera_ECOSYS",
        "is_active": true
      },
      {
        "id": 2,
        "printer_index": 1,
        "name": "Brother_QL-820",
        "is_active": true
      },
      {
        "id": 3,
        "printer_index": 2,
        "name": "EPSON_TM-T88",
        "is_active": true
      }
    ]
  },
  "message": "プリンタリストを同期しました"
}
```

---

### 5.5 印刷ジョブ取得（ポーリング）

```
GET /api/printer/polling?warehouse_id={warehouse_id}
Authorization: Bearer {token}
X-Client-Id: {client_uuid}
```

**レスポンス（ジョブあり）:**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "print_type": "delivery_slip",
      "file_path": "vouchers/slip_123.pdf",
      "printer_driver_id": 1,
      "printer_name": "Kyocera_ECOSYS",
      "printer_index": 0,
      "routing_type": "dedicated_slip",
      "buyer_id": 456,
      "buyer_name": "〇〇商店",
      "order": 1
    },
    {
      "id": 124,
      "print_type": "delivery_slip",
      "file_path": "vouchers/slip_124.pdf",
      "printer_driver_id": 2,
      "printer_name": "Brother_QL-820",
      "printer_index": 1,
      "routing_type": "course",
      "buyer_id": 789,
      "buyer_name": "△△酒店",
      "order": 2
    },
    {
      "id": 125,
      "print_type": "delivery_slip",
      "file_path": "vouchers/slip_125.pdf",
      "printer_driver_id": 1,
      "printer_name": "Kyocera_ECOSYS",
      "printer_index": 0,
      "routing_type": "default",
      "buyer_id": 999,
      "buyer_name": "□□ストア",
      "order": 3
    }
  ],
  "meta": {
    "total": 3,
    "warehouse_id": 1
  }
}
```

**レスポンス（ジョブなし）:**
```json
{
  "success": true,
  "data": [],
  "meta": {
    "total": 0,
    "warehouse_id": 1
  }
}
```

---

### 5.6 印刷完了報告

```
POST /api/printer/jobs/{job_id}/complete
Authorization: Bearer {token}
Content-Type: application/json
X-Client-Id: {client_uuid}
```

**リクエスト（成功時）:**
```json
{
  "status": "success",
  "printed_at": "2026-01-02T10:05:00Z",
  "printer_name": "Kyocera_ECOSYS"
}
```

**リクエスト（エラー時）:**
```json
{
  "status": "error",
  "error_message": "プリンタがオフラインです"
}
```

**レスポンス:**
```json
{
  "success": true,
  "message": "印刷完了を記録しました"
}
```

---

### 5.7 専用伝票プリンタ設定一覧

```
GET /api/admin/client-printer-slip-type-printers
Authorization: Bearer {token}
```

**レスポンス:**
```json
{
  "success": true,
  "data": [
    {
      "slip_type": {
        "id": 1,
        "code": 101,
        "name": "〇〇商店専用"
      },
      "printers": [
        {
          "id": 1,
          "printer_driver_id": 1,
          "printer_name": "Kyocera_ECOSYS",
          "warehouse_name": "倉庫A",
          "is_default": true
        },
        {
          "id": 2,
          "printer_driver_id": 2,
          "printer_name": "Brother_QL-820",
          "warehouse_name": "倉庫A",
          "is_default": false
        }
      ]
    },
    {
      "slip_type": {
        "id": 2,
        "code": 102,
        "name": "△△酒店専用"
      },
      "printers": [
        {
          "id": 3,
          "printer_driver_id": 3,
          "printer_name": "EPSON_TM-T88",
          "warehouse_name": "倉庫B",
          "is_default": true
        }
      ]
    }
  ]
}
```

---

### 5.8 専用伝票プリンタ設定更新

```
PUT /api/admin/client-printer-slip-type-printers/{slip_type_id}
Authorization: Bearer {token}
Content-Type: application/json
```

**リクエスト:**
```json
{
  "printers": [
    {
      "printer_driver_id": 1,
      "is_default": true
    },
    {
      "printer_driver_id": 2,
      "is_default": false
    }
  ]
}
```

**レスポンス:**
```json
{
  "success": true,
  "message": "専用伝票プリンタ設定を更新しました"
}
```

---

### 5.9 配送コース別設定一覧

```
GET /api/admin/client-printer-course-settings?warehouse_id={warehouse_id}
Authorization: Bearer {token}
```

**レスポンス:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "delivery_course": {
        "id": 10,
        "code": "NORTH",
        "name": "北部ルート"
      },
      "printer": {
        "id": 1,
        "name": "Kyocera_ECOSYS",
        "printer_index": 0
      },
      "is_active": true
    },
    {
      "id": 2,
      "delivery_course": {
        "id": 11,
        "code": "SOUTH",
        "name": "南部ルート"
      },
      "printer": {
        "id": 2,
        "name": "Brother_QL-820",
        "printer_index": 1
      },
      "is_active": true
    }
  ]
}
```

---

### 5.10 配送コース別設定追加

```
POST /api/admin/client-printer-course-settings
Authorization: Bearer {token}
Content-Type: application/json
```

**リクエスト:**
```json
{
  "warehouse_id": 1,
  "delivery_course_id": 12,
  "printer_driver_id": 3
}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "id": 3,
    "warehouse_id": 1,
    "delivery_course_id": 12,
    "printer_driver_id": 3
  },
  "message": "配送コース別プリンタ設定を追加しました"
}
```

---

### 5.11 配送コース別設定更新

```
PUT /api/admin/client-printer-course-settings/{id}
Authorization: Bearer {token}
Content-Type: application/json
```

**リクエスト:**
```json
{
  "printer_driver_id": 4,
  "is_active": true
}
```

**レスポンス:**
```json
{
  "success": true,
  "message": "配送コース別プリンタ設定を更新しました"
}
```

---

### 5.12 配送コース別設定削除

```
DELETE /api/admin/client-printer-course-settings/{id}
Authorization: Bearer {token}
```

**レスポンス:**
```json
{
  "success": true,
  "message": "配送コース別プリンタ設定を削除しました"
}
```

---

## 6. エラーレスポンス

### 6.1 共通エラー形式

```json
{
  "success": false,
  "message": "エラーメッセージ",
  "error_code": "ERROR_CODE",
  "debug_message": "開発用詳細メッセージ（本番では非表示）"
}
```

### 6.2 エラーコード一覧

| コード | HTTPステータス | 説明 |
|--------|----------------|------|
| `UNAUTHORIZED` | 401 | 認証失敗 |
| `FORBIDDEN` | 403 | 権限なし |
| `NOT_FOUND` | 404 | リソースが見つからない |
| `VALIDATION_ERROR` | 422 | バリデーションエラー |
| `WAREHOUSE_NOT_FOUND` | 404 | 倉庫が見つからない |
| `PRINTER_NOT_FOUND` | 404 | プリンタが見つからない |
| `SYNC_FAILED` | 500 | 同期失敗 |

---

## 7. クライアント側実装ガイド

### 7.1 初期設定フロー

```javascript
// 1. 倉庫一覧取得
const warehouses = await api.get('/api/printer/warehouses');

// 2. ユーザーが倉庫を選択
const selectedWarehouseId = userSelectWarehouse(warehouses);

// 3. ローカルプリンタ一覧を取得
const localPrinters = await getSystemPrinters();

// 4. サーバーにプリンタリストを同期
const syncResult = await api.post(
  `/api/printer/warehouses/${selectedWarehouseId}/printers/sync`,
  {
    printers: localPrinters.map((p, index) => ({
      printer_index: index,
      name: p.name,
      is_default: p.isDefault
    }))
  }
);

// 5. 設定を保存
saveConfig({
  warehouseId: selectedWarehouseId,
  printers: syncResult.printers
});
```

### 7.2 ポーリング処理

```javascript
async function pollAndPrint() {
  // 1. 印刷ジョブ取得
  const response = await api.get(
    `/api/printer/polling?warehouse_id=${config.warehouseId}`
  );

  if (!response.success || response.data.length === 0) {
    return; // ジョブなし
  }

  // 2. ダウンロード（並列）
  const jobs = await downloadFilesInParallel(response.data);

  // 3. 印刷（順次）
  for (const job of jobs) {
    // サーバーが指定したprinter_indexを使用
    const printerName = config[`printer${job.printer_index}`];

    await printPdf(printerName, job.localPath);

    // 4. 完了報告
    await api.post(`/api/printer/jobs/${job.id}/complete`, {
      status: 'success',
      printed_at: new Date().toISOString(),
      printer_name: printerName
    });
  }
}
```

---

## 8. 管理画面UI設計

### 8.1 専用伝票プリンタ設定画面

```
┌─────────────────────────────────────────────────────────────────────┐
│ 専用伝票プリンタ設定                                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 伝票タイプ: [〇〇商店専用 ▼]                                        │
│                                                                     │
│ 使用可能プリンター:                                                  │
│   ☑ Kyocera_ECOSYS #1 (倉庫A)  ◉ デフォルト                        │
│   ☑ Brother_QL-820 #2 (倉庫A)  ○                                   │
│   ☐ EPSON_TM-T88 #3 (倉庫B)                                        │
│                                                                     │
│              [キャンセル]  [保存]                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 配送コース別プリンタ設定画面

```
┌─────────────────────────────────────────────────────────────────────┐
│ 配送コース別プリンタ設定                              [+ 新規追加]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 倉庫: [倉庫A ▼]                                                     │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 配送コース      │ プリンタ              │ 操作                 │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ 北部ルート      │ Kyocera #1            │ [編集] [削除]        │ │
│ │ 南部ルート      │ Brother #2            │ [編集] [削除]        │ │
│ │ 東部ルート      │ (未設定→倉庫デフォルト)│ [設定]               │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ ※ 専用伝票の得意先は自動的に専用プリンタへルーティングされます      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. まとめ

### 9.1 テーブル

| テーブル | 状態 |
|----------|------|
| `client_printer_drivers` | 既存 |
| `slip_types` | 既存 |
| `client_printer_slip_type_printers` | **新規** |
| `client_printer_course_settings` | **新規** |

### 9.2 クライアントAPI（6個）

| API | 用途 |
|-----|------|
| `GET /api/printer/test` | 接続テスト |
| `GET /api/printer/warehouses` | 倉庫一覧 |
| `GET /api/printer/warehouses/{id}/printers` | プリンタ一覧 |
| `POST /api/printer/warehouses/{id}/printers/sync` | プリンタ同期 |
| `GET /api/printer/polling` | 印刷ジョブ取得 |
| `POST /api/printer/jobs/{id}/complete` | 完了報告 |

### 9.3 管理画面API（9個）

| API | 用途 |
|-----|------|
| `GET /api/admin/client-printer-drivers` | プリンタ一覧 |
| `GET /api/admin/slip-types` | 伝票タイプ一覧 |
| `GET /api/admin/client-printer-slip-type-printers` | 専用伝票設定一覧 |
| `PUT /api/admin/client-printer-slip-type-printers/{id}` | 専用伝票設定更新 |
| `GET /api/admin/delivery-courses` | 配送コース一覧 |
| `GET /api/admin/client-printer-course-settings` | コース別設定一覧 |
| `POST /api/admin/client-printer-course-settings` | コース別設定追加 |
| `PUT /api/admin/client-printer-course-settings/{id}` | コース別設定更新 |
| `DELETE /api/admin/client-printer-course-settings/{id}` | コース別設定削除 |

### 9.4 印刷ルーティング優先順位

| 優先度 | 条件 | プリンタ決定 |
|--------|------|--------------|
| 1 | 専用伝票 (`slip_type_id` あり) | `client_printer_slip_type_printers` から選択 |
| 2 | 配送コース設定あり | `client_printer_course_settings` |
| 3 | 上記以外 | `client_printer_drivers` (倉庫デフォルト) |