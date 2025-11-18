# Sakemaru Core API アップデート通知 v2.1

**更新日**: 2025年11月18日
**対象**: ローカルプリンターシステム開発者
**重要度**: 🔴 高（API変更あり）

---

## 📋 目次

1. [変更概要](#変更概要)
2. [破壊的変更](#破壊的変更)
3. [新機能](#新機能)
4. [マイグレーションガイド](#マイグレーションガイド)
5. [API変更詳細](#api変更詳細)
6. [実装例](#実装例)
7. [テスト方法](#テスト方法)
8. [FAQ](#faq)

---

## 変更概要

### 主要な変更点

1. ✅ **`printer_id` → `printer_index` への変更**
   - API レスポンスフィールド名の変更
   - より明確な命名規則への統一

2. ✅ **配送コース別プリンター印刷機能の追加**
   - 伝票を配送コースごとに自動グルーピング
   - 異なるプリンターへの自動振り分け
   - ファイル名に `_p{printer_index}` サフィックス追加

3. ✅ **倉庫＋プリンターインデックスのユニーク制約**
   - 同一倉庫で重複するプリンターインデックスを防止
   - データ整合性の向上

---

## 破壊的変更

### ⚠️ 1. APIレスポンスフィールド名の変更

**影響するエンドポイント**: `GET /api/printer/polling`

**変更前（v2.0以前）**:
```json
{
  "printer_drivers": {
    "print_driver_name": "HP LaserJet Pro",
    "warehouse_id": 1,
    "printer_id": 1,  // ← 旧フィールド名
    "warehouse": {...}
  }
}
```

**変更後（v2.1）**:
```json
{
  "printer_drivers": {
    "print_driver_name": "HP LaserJet Pro",
    "warehouse_id": 1,
    "printer_index": 1,  // ← 新フィールド名
    "warehouse": {...}
  }
}
```

### ⚠️ 2. プリンタードライバー作成APIパラメータ変更

**エンドポイント**: `POST /api/printer/driver`

**変更前（v2.0以前）**:
```json
{
  "warehouse_id": 1,
  "printer_id": 1,  // ← 旧パラメータ名
  "print_driver_name": "HP LaserJet Pro"
}
```

**変更後（v2.1）**:
```json
{
  "warehouse_id": 1,
  "printer_index": 1,  // ← 新パラメータ名
  "print_driver_name": "HP LaserJet Pro"
}
```

---

## 新機能

### 🆕 配送コース別プリンター印刷

#### 概要

伝票印刷時に、配送コース別に自動的にPDFをグルーピングし、異なるプリンターで印刷できるようになりました。

#### メリット

- 📦 **配送コースごとに物理的に異なるプリンターで印刷可能**
- 🚀 **印刷業務の効率化** - 配送担当者ごとにプリンターを分離
- 🎯 **自動振り分け** - 手動でのプリンター選択が不要

#### 動作フロー

```
[サーバー側]
1. 複数の伝票（Earning）を選択
2. 各伝票の配送コースを確認
3. 配送コース → プリンタードライバー → printer_index を取得
4. printer_index ごとにPDFを生成
   - 例: 伝票_20251118_123456_p0.pdf
   - 例: 伝票_20251118_123456_p1.pdf
   - 例: 伝票_20251118_123456_p2.pdf

[ローカルプリンター側]
5. ポーリングで各印刷ジョブを取得
6. printer_index に基づいて適切なプリンターで印刷
   - printer_index: 0 → config.printer0
   - printer_index: 1 → config.printer1
   - printer_index: 2 → config.printer2
   - printer_index: 3 → config.printer3
```

#### ファイル命名規則

**従来**:
```
伝票_20251118_123456.pdf
```

**配送コース別印刷時**:
```
伝票_20251118_123456_p0.pdf   // printer_index=0 のグループ
伝票_20251118_123456_p1.pdf   // printer_index=1 のグループ
伝票_20251118_123456_p2.pdf   // printer_index=2 のグループ
```

---

## マイグレーションガイド

### ステップ1: コード変更

#### 必須変更箇所

**1. ポーリング処理のフィールド名変更**

```javascript
// ❌ 変更前
const printerId = job.printer_drivers?.printer_id ?? 0;

// ✅ 変更後
const printerIndex = job.printer_drivers?.printer_index ?? 0;
```

**2. プリンター選択ロジック**

```javascript
// ❌ 変更前
const printerName = config[`printer${job.printer_drivers.printer_id}`];

// ✅ 変更後
const printerIndex = job.printer_drivers?.printer_index ?? 0;
const printerName = config[`printer${printerIndex}`];
```

**3. プリンタードライバー登録（管理機能を使用する場合）**

```javascript
// ❌ 変更前
await fetch(`${apiHost}/api/printer/driver`, {
  method: 'POST',
  headers: headers,
  body: JSON.stringify({
    warehouse_id: 1,
    printer_id: 1,  // ← 旧
    print_driver_name: 'HP LaserJet Pro'
  })
});

// ✅ 変更後
await fetch(`${apiHost}/api/printer/driver`, {
  method: 'POST',
  headers: headers,
  body: JSON.stringify({
    warehouse_id: 1,
    printer_index: 1,  // ← 新
    print_driver_name: 'HP LaserJet Pro'
  })
});
```

### ステップ2: 後方互換性の確保（推奨）

一時的に両方のフィールドをサポートすることで、段階的な移行が可能です：

```javascript
// 後方互換性を持たせた実装
const printerIndex = job.printer_drivers?.printer_index
                  ?? job.printer_drivers?.printer_id  // フォールバック
                  ?? 0;

const printerName = config[`printer${printerIndex}`];
```

### ステップ3: 動作確認

1. **ローカルプリンターシステムの更新**
   ```bash
   cd /path/to/sakemaru-local-printer
   git pull
   npm install
   # アプリを再起動
   ```

2. **設定の確認**
   - 既存の設定ファイルは自動的に維持されます
   - `warehouse_id` フィールドが新たに追加されますが、オプションです

3. **テスト印刷**
   - サーバー側で伝票印刷を実行
   - ローカルプリンターでポーリング
   - 正しいプリンターで印刷されることを確認

---

## API変更詳細

### 1. GET /api/printer/polling

**変更内容**: レスポンスフィールド名の変更

**変更前**:
```json
{
  "success": true,
  "data": {
    "data": [
      {
        "printer_drivers": {
          "printer_id": 1  // ← 旧
        }
      }
    ]
  }
}
```

**変更後**:
```json
{
  "success": true,
  "data": {
    "data": [
      {
        "printer_drivers": {
          "printer_index": 1  // ← 新
        }
      }
    ]
  }
}
```

### 2. POST /api/printer/driver

**変更内容**: リクエストパラメータ名の変更

**変更前**:
```json
{
  "warehouse_id": 1,
  "printer_id": 1,  // ← 旧（非推奨）
  "print_driver_name": "HP LaserJet Pro"
}
```

**変更後**:
```json
{
  "warehouse_id": 1,
  "printer_index": 1,  // ← 新（推奨）
  "print_driver_name": "HP LaserJet Pro"
}
```

**注意**: `printer_index` は 0〜3 の範囲である必要があります。範囲外の値はバリデーションエラーになります。

### 3. その他のエンドポイント

以下のエンドポイントは変更ありません：
- `GET /api/printer/warehouses`
- `POST /api/printer/document-slip-status`
- `POST /api/printer/document-picking-status`

---

## 実装例

### 完全な実装例（JavaScript）

```javascript
// config.js
const config = {
  apiHost: 'tani-hub.sakemaru.click',
  apiToken: 'your-api-token',
  pollInterval: 5000,  // 5秒
  warehouseId: null,   // 全倉庫 or 特定倉庫ID
  printer0: 'Default Printer',
  printer1: 'Warehouse A Printer',
  printer2: 'Warehouse B Printer',
  printer3: 'Warehouse C Printer'
};

// polling.js
async function pollPrintJobs() {
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
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    const jobs = result.success && result.data && result.data.data
      ? result.data.data
      : [];

    // 3. 各ジョブを処理
    for (const job of jobs) {
      await processPrintJob(job);
    }

  } catch (error) {
    console.error('ポーリングエラー:', error);
  }
}

async function processPrintJob(job) {
  try {
    // 1. printer_index を取得（後方互換性あり）
    const printerIndex = job.printer_drivers?.printer_index
                      ?? job.printer_drivers?.printer_id
                      ?? 0;

    // 2. 対応するローカルプリンターを取得
    const printerName = config[`printer${printerIndex}`];

    if (!printerName) {
      console.warn(`プリンター${printerIndex}が未設定、デフォルトプリンターを使用`);
      printerName = config.printer0;
    }

    console.log(`印刷開始: ID=${job.id}, type=${job.print_type}, printer=${printerName}`);

    // 3. PDFダウンロード
    const localPath = await downloadPDF(job.file_path);

    // 4. 印刷実行
    await printPDF(printerName, localPath);

    // 5. ステータス更新
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

    console.log(`印刷完了: ID=${job.id}`);

    // 6. ローカルファイル削除
    fs.unlinkSync(localPath);

  } catch (error) {
    console.error(`印刷エラー: ID=${job.id}`, error);

    // エラー時のステータス更新
    try {
      const statusUrl = `https://${config.apiHost}/api/printer/document-${job.print_type}-status`;
      await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiToken}`
        },
        body: JSON.stringify({
          id: job.id,
          status: 'FAILURE'
        })
      });
    } catch (statusError) {
      console.error('ステータス更新エラー:', statusError);
    }
  }
}

async function downloadPDF(s3Path) {
  // S3からPDFをダウンロード
  const localPath = `/tmp/${path.basename(s3Path)}`;
  // ... ダウンロード処理 ...
  return localPath;
}

async function printPDF(printerName, filePath) {
  // プリンターで印刷
  // Windows: await exec(`print /D:"${printerName}" "${filePath}"`);
  // macOS: await exec(`lp -d "${printerName}" "${filePath}"`);
  // Linux: await exec(`lp -d "${printerName}" "${filePath}"`);
}

// メインループ
setInterval(pollPrintJobs, config.pollInterval);
```

---

## テスト方法

### 1. ローカル環境でのテスト

```bash
# 1. コードを更新
cd /path/to/sakemaru-local-printer
git pull origin main

# 2. 依存関係をインストール
npm install

# 3. 設定ファイルを確認
cat config.json
# または
cat settings.json

# 4. アプリを起動
npm start
```

### 2. API動作確認

**cURLでテスト**:

```bash
# プリンタードライバー作成テスト
curl -X POST "https://tani-hub.sakemaru.click/api/printer/driver" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "warehouse_id": 1,
    "printer_index": 1,
    "print_driver_name": "Test Printer"
  }'

# ポーリングテスト
curl -X GET "https://tani-hub.sakemaru.click/api/printer/polling" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json"

# 倉庫フィルター付きポーリングテスト
curl -X GET "https://tani-hub.sakemaru.click/api/printer/polling?warehouse_id=1" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json"
```

### 3. 配送コース別印刷のテスト手順

1. **サーバー側で配送コース設定**（管理画面で実装予定）
   - 配送コース A → printer_index: 0
   - 配送コース B → printer_index: 1
   - 配送コース C → printer_index: 2

2. **複数の伝票を印刷**
   - 異なる配送コースの伝票を複数選択
   - 伝票印刷を実行

3. **ローカルプリンターで確認**
   - ポーリングで複数の印刷ジョブを取得
   - 各ジョブの `printer_index` を確認
   - 異なるプリンターで印刷されることを確認

---

## FAQ

### Q1: `printer_id` フィールドは完全に削除されましたか？

**A**: いいえ。サーバー側では後方互換性のため、一時的に `printer_id` も認識しますが、将来的に削除予定です。新しいコードでは必ず `printer_index` を使用してください。

### Q2: 既存のローカルプリンターシステムはそのまま動作しますか？

**A**: 短期的には動作しますが、以下の理由で早めの更新を推奨します：
- 将来のバージョンで `printer_id` サポートが削除される可能性
- 配送コース別印刷などの新機能が使えない
- セキュリティアップデートが含まれる可能性

### Q3: `printer_index` の範囲は？

**A**: 0〜3 の4つのプリンターまでサポートされています。これはローカルプリンターシステムの `printer0`〜`printer3` に対応しています。

### Q4: 配送コース別印刷機能は必須ですか？

**A**: いいえ、オプションです。配送コースに `client_printer_driver_id` が設定されていない場合は、従来通り1つのPDFファイルとして生成されます。

### Q5: ファイル名の `_p0`, `_p1` サフィックスはいつ付きますか？

**A**: 配送コース別印刷が有効な場合のみです。通常の印刷では従来通りのファイル名になります。

### Q6: 複数のプリンターが同時に印刷を開始しますか？

**A**: ローカルプリンターシステムの実装次第ですが、通常はポーリングで順次ジョブを取得し、順番に印刷されます。並列処理を実装することも可能です。

### Q7: printer_index が設定されていないジョブはどうなりますか？

**A**: デフォルト値の `0` が使用され、`printer0`（デフォルトプリンター）で印刷されます。

### Q8: サーバー側のマイグレーションは必要ですか？

**A**: はい、サーバー側で以下のマイグレーションが実行される必要があります：
- `client_printer_drivers` テーブルの `printer_id` → `printer_index` リネーム
- `delivery_courses` テーブルへの `client_printer_driver_id` カラム追加

---

## サポート

### 問題が発生した場合

1. **ログを確認**
   - ローカルプリンターのログファイル
   - サーバー側のログ

2. **APIレスポンスを確認**
   - ポーリングAPIのレスポンスに `printer_index` が含まれているか
   - エラーレスポンスの内容

3. **設定を確認**
   - `config.printer0`〜`config.printer3` が正しく設定されているか
   - APIトークンが有効か

4. **連絡先**
   - GitHub Issues: [sakemaru-local-printer/issues](リンクを記載)
   - 開発チーム: [メールアドレスを記載]

---

## 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| v2.1 | 2025-11-18 | ・`printer_id` → `printer_index` 変更<br>・配送コース別印刷機能追加<br>・ユニーク制約追加 |
| v2.0 | 2025-01-18 | ・HTTPメソッド変更（GET対応）<br>・倉庫フィルター追加 |
| v1.0 | 2024-XX-XX | 初期リリース |

---

**更新日**: 2025年11月18日
**ドキュメントバージョン**: 1.0
**対象システムバージョン**: Sakemaru Core API v2.1+
