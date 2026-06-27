// main.js
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fetch = global.fetch; // Node18+ のグローバル fetch
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { exec, execFile } = require('child_process');
const crypto = require('crypto');
const printerLib = require('pdf-to-printer'); // 追加が必要
const { PDFDocument, degrees } = require('pdf-lib');
const AutoLaunch = require('auto-launch');

// アプリケーション名を設定
app.name = 'Sakemaru';

// シングルインスタンスロック
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // 既に別のインスタンスが起動している場合、このインスタンスを終了
    console.log('Another instance is already running. Quitting...');
    app.quit();
} else {
    // 2つ目のインスタンスが起動しようとした場合の処理
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('Second instance detected. Focusing existing window...');
        // 既存のウィンドウがある場合、それを表示してフォーカス
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        } else {
            // ウィンドウがない場合は作成
            createMainWindow();
        }
    });
}

// 自動起動設定
const autoLauncher = new AutoLaunch({
    name: 'Sakemaru',
    path: app.getPath('exe'),
});

// 設定ファイルパス（ユーザーデータディレクトリに配置）
const userDataPath = app.getPath('userData');

// プロファイル管理: 本番(prod) / ステージング(stg) の2固定
// テンプレート(変更不可): プロジェクトルートの config-prod.json / config-stg.json
// ユーザー編集可: userData/config-prod.json / userData/config-stg.json
// 現在のアクティブプロファイル: userData/active.json
const VALID_PROFILES = ['prod', 'stg'];
const activeFilePath = path.join(userDataPath, 'active.json');

function getUserConfigPath(profile) {
    return path.join(userDataPath, `config-${profile}.json`);
}
function getTemplateConfigPath(profile) {
    return path.join(__dirname, `config-${profile}.json`);
}

function loadActiveProfile() {
    try {
        if (fs.existsSync(activeFilePath)) {
            const obj = JSON.parse(fs.readFileSync(activeFilePath, 'utf-8'));
            if (obj && VALID_PROFILES.includes(obj.profile)) return obj.profile;
        }
    } catch (e) {
        console.error('Failed to read active.json:', e);
    }
    return 'prod';
}

function saveActiveProfile(profile) {
    try {
        fs.writeFileSync(activeFilePath, JSON.stringify({ profile }, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error('Failed to write active.json:', e);
        return false;
    }
}

let activeProfile = loadActiveProfile();
let configPath = getUserConfigPath(activeProfile);

// UUID生成関数
function generateClientId() {
    return crypto.randomUUID();
}

// デフォルト設定
const defaultConfig = {
    clientId: '', // クライアント固有のUUID（初回起動時に自動生成）
    pollInterval: 5000,
    apiHost: '',
    apiToken: '',
    warehouseId: '', // 倉庫ID（オプション、指定すると該当倉庫の印刷ジョブのみ取得）
    printer0: '',
    printer1: '',
    printer2: '',
    printer3: '',
    printer4: '',
    printer5: '',
    printer6: '',
    printer7: '',
    printer8: '',
    printer9: '',
    printMethod: 'pdf-to-printer', // 'pdf-to-printer' or 'sumatra-direct'
    sumatraPdfPath: 'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    printerSettings: {}, // プリンタ別印刷設定 { [printerName]: { orientation, paperSize, offsetX, offsetY } }
    s3: {
        bucket: '',
        region: 'ap-northeast-1',
        accessKeyId: '',
        secretAccessKey: ''
    }
};

// プリンタスロット数
const MAX_PRINTERS = 10;

// 指定プロファイルの設定をロードする（無ければテンプレートからコピー、なお無ければデフォルト）
function loadConfigForProfile(profile) {
    const userPath = getUserConfigPath(profile);
    const tmplPath = getTemplateConfigPath(profile);
    let cfg;

    if (fs.existsSync(userPath)) {
        cfg = JSON.parse(fs.readFileSync(userPath, 'utf-8'));
        console.log(`Configuration loaded from user file (${profile}):`, userPath);
    } else if (fs.existsSync(tmplPath)) {
        // テンプレートをコピー（テンプレ自体は変更不可、これは初回の種だけ）
        cfg = JSON.parse(fs.readFileSync(tmplPath, 'utf-8'));
        console.log(`Configuration seeded from template (${profile}):`, tmplPath);
        fs.writeFileSync(userPath, JSON.stringify(cfg, null, 2), 'utf-8');
        console.log(`Saved initial config (${profile}) to:`, userPath);
    } else {
        cfg = { ...defaultConfig };
        console.log(`Using default configuration (no template found for ${profile})`);
        fs.writeFileSync(userPath, JSON.stringify(cfg, null, 2), 'utf-8');
    }

    // clientId が無ければ生成して書き戻し（プロファイルごとに独立した clientId）
    if (!cfg.clientId) {
        cfg.clientId = generateClientId();
        fs.writeFileSync(userPath, JSON.stringify(cfg, null, 2), 'utf-8');
        console.log(`Generated new client ID for ${profile}:`, cfg.clientId);
    }

    return cfg;
}

let config = loadConfigForProfile(activeProfile);

// 共通APIヘッダーを構築
function buildApiHeaders() {
    // clientIdが未設定の場合は再生成
    if (!config.clientId) {
        config.clientId = generateClientId();
        saveConfigToFile();
        console.log('Regenerated client ID:', config.clientId);
    }

    const headers = {
        'Content-Type': 'application/json',
        'X-Client-Id': config.clientId
    };

    if (config.apiToken) {
        headers['Authorization'] = `Bearer ${config.apiToken}`;
    }

    console.log('API Headers - X-Client-Id:', config.clientId);
    return headers;
}

// 設定を保存する関数
function saveConfigToFile() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log('Configuration saved to:', configPath);
        return true;
    } catch (err) {
        console.error('Failed to save config:', err);
        writeLog(`設定の保存に失敗: ${err.message}`, 'error');
        return false;
    }
}

let mainWindow;
let configWindow;
let statusWindow;
let pollingTimer = null;
let tray = null;

// ログファイル管理
const logsDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// 日別ログファイルパスを取得
function getLogFilePath() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(logsDir, `log_${today}.txt`);
}

// ログをファイルに書き込み、UIにも送信
function writeLog(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

    // ファイルに追記
    try {
        fs.appendFileSync(getLogFilePath(), logLine, 'utf-8');
    } catch (err) {
        console.error('Failed to write log:', err);
    }

    // UIに送信
    if (mainWindow) {
        mainWindow.webContents.send('poll-status', {
            status: 'log',
            message: message,
            type: type
        });
    }
}

// ローカルIP取得
function getLocalIp() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) return net.address;
        }
    }
    return '127.0.0.1';
}


// プリンタ別印刷設定を取得（プリンタスロット index ベース）
// 未設定/未指定の項目は 'auto' / 0 として返す
function getPrinterSettingsByIndex(printerIndex) {
    const key = String(printerIndex);
    const settings = (config.printerSettings && config.printerSettings[key]) || {};
    return {
        orientation: settings.orientation || 'auto', // 'auto' | 'portrait' | 'landscape'
        paperSize: settings.paperSize || 'auto',     // 'auto' | 'A4' | 'A5' | 'B5' | 'Letter' | 'Custom191x131' | 'Custom131x191'
        offsetX: Number(settings.offsetX) || 0,      // mm
        offsetY: Number(settings.offsetY) || 0,      // mm
        noScale: !!settings.noScale,                 // true: 原寸印刷（縮小しない）、上端揃え
    };
}

// 用紙サイズ名 → ポイント (1mm = 2.834645669pt)
const PAPER_SIZES_PT = {
    A4:     { width: 595.28, height: 841.89 },
    A5:     { width: 419.53, height: 595.28 },
    B5:     { width: 498.90, height: 708.66 },
    Letter: { width: 612.00, height: 792.00 },
    // カスタム: 191mm × 131mm（幅×高さ、横長基準）
    'Custom191x131': { width: 191 * 2.834645669, height: 131 * 2.834645669 },
    // カスタム: 131mm × 191mm（幅×高さ、縦長基準）
    'Custom131x191': { width: 131 * 2.834645669, height: 191 * 2.834645669 },
};

// 設定がすべてデフォルト（auto / 0 / false）かどうか
function isDefaultSettings(s) {
    return s.orientation === 'auto'
        && s.paperSize === 'auto'
        && (!s.offsetX || s.offsetX === 0)
        && (!s.offsetY || s.offsetY === 0)
        && !s.noScale;
}

// pdf-libでPDFに印刷設定を適用して新しい一時PDFを生成
// 戻り値: 加工後の一時ファイルパス（呼び出し側で削除責務を持つ）
async function applyPrintSettingsToPdf(localFilePath, settings) {
    const MM_TO_PT = 2.834645669;
    const srcBytes = fs.readFileSync(localFilePath);
    const srcDoc = await PDFDocument.load(srcBytes);
    const outDoc = await PDFDocument.create();

    const srcPages = srcDoc.getPages();
    const srcIndices = srcPages.map((_, i) => i);
    const copiedPages = await outDoc.copyPages(srcDoc, srcIndices);

    const targetPaper = settings.paperSize !== 'auto' ? PAPER_SIZES_PT[settings.paperSize] : null;
    const offsetXPt = (settings.offsetX || 0) * MM_TO_PT;
    const offsetYPt = (settings.offsetY || 0) * MM_TO_PT;

    for (let i = 0; i < copiedPages.length; i++) {
        const srcPage = copiedPages[i];
        const { width: srcW, height: srcH } = srcPage.getSize();

        // ターゲットの用紙サイズと向きを決定
        let targetW, targetH;
        if (targetPaper) {
            targetW = targetPaper.width;
            targetH = targetPaper.height;
        } else {
            targetW = srcW;
            targetH = srcH;
        }

        // 向き指定がある場合は targetW/H を入れ替え
        if (settings.orientation === 'landscape' && targetW < targetH) {
            [targetW, targetH] = [targetH, targetW];
        } else if (settings.orientation === 'portrait' && targetW > targetH) {
            [targetW, targetH] = [targetH, targetW];
        }

        // 新規ページを作成し、元ページを XObject として埋め込み
        const newPage = outDoc.addPage([targetW, targetH]);
        const embedded = await outDoc.embedPage(srcPage);

        // 縮小ポリシー: noScale=true なら原寸維持。それ以外は用紙に収まるよう縮小（拡大はしない）
        const scale = settings.noScale
            ? 1
            : Math.min(targetW / srcW, targetH / srcH, 1);
        const drawnW = srcW * scale;
        const drawnH = srcH * scale;

        // 配置: 左右は中央、Y は noScale なら上端揃え、それ以外は中央
        // PDF座標系は左下原点。
        // offsetX: 正なら右へ移動
        // offsetY: 通常モードは「正で上へ」、noScale モードは「正で下へ」（用紙の上端からの下げ量として直感的）
        const x = (targetW - drawnW) / 2 + offsetXPt;
        const y = settings.noScale
            ? (targetH - drawnH) - offsetYPt
            : (targetH - drawnH) / 2 + offsetYPt;

        newPage.drawPage(embedded, {
            x,
            y,
            xScale: scale,
            yScale: scale,
        });
    }

    const outBytes = await outDoc.save();
    const outPath = path.join(
        app.getPath('temp'),
        `print_${Date.now()}_${path.basename(localFilePath)}`
    );
    fs.writeFileSync(outPath, outBytes);
    return outPath;
}

async function printPdf(printerName, localFilePath, printerIndex = null, overrideSettings = null) {
    const platform = os.platform();
    // overrideSettings が渡されていればそれを優先（テスト印刷用）。
    // それ以外で printerIndex が指定されていればそのスロットの設定。
    // どちらもない場合はデフォルト。
    let settings;
    if (overrideSettings) {
        settings = {
            orientation: overrideSettings.orientation || 'auto',
            paperSize: overrideSettings.paperSize || 'auto',
            offsetX: Number(overrideSettings.offsetX) || 0,
            offsetY: Number(overrideSettings.offsetY) || 0,
            noScale: !!overrideSettings.noScale,
        };
    } else if (printerIndex !== null) {
        settings = getPrinterSettingsByIndex(printerIndex);
    } else {
        settings = { orientation: 'auto', paperSize: 'auto', offsetX: 0, offsetY: 0, noScale: false };
    }
    const hasCustomSettings = !isDefaultSettings(settings);

    // カスタム設定がある場合は pdf-lib で加工した一時PDFを使用
    let printFilePath = localFilePath;
    let tempProcessedPath = null;

    if (hasCustomSettings) {
        try {
            tempProcessedPath = await applyPrintSettingsToPdf(localFilePath, settings);
            printFilePath = tempProcessedPath;
            writeLog(
                `印刷設定適用: slot=${printerIndex}, printer=${printerName}, ` +
                `orientation=${settings.orientation}, paper=${settings.paperSize}, ` +
                `offset=(${settings.offsetX}mm, ${settings.offsetY}mm), noScale=${settings.noScale}`,
                'info'
            );
        } catch (err) {
            writeLog(`印刷設定適用エラー（元のPDFで印刷続行）: ${err.message}`, 'error');
            printFilePath = localFilePath;
        }
    }

    // SumatraPDF 用 print-settings 文字列を構築
    // paperSize は pdf-lib で既に適用済みのため、ここでは fit のみで原寸を維持
    // 標準用紙のみ paper= を指定（SumatraPDF が認識する名前: A4/A5/B5/Letter）
    const SUMATRA_PAPER_NAMES = ['A4', 'A5', 'B5', 'Letter'];
    function buildSumatraSettings() {
        const parts = [];
        if (settings.paperSize !== 'auto' && SUMATRA_PAPER_NAMES.includes(settings.paperSize)) {
            parts.push(`paper=${settings.paperSize}`);
        } else if (settings.paperSize === 'auto') {
            parts.push('paper=A4');
        }
        // カスタム用紙の場合は paper= を指定しない（プリンタの既定/トレイ設定に従う）
        if (settings.orientation === 'portrait') {
            parts.push('portrait');
        } else if (settings.orientation === 'landscape') {
            parts.push('landscape');
        }
        // noScale 明示 もしくは pdf-lib で加工済みの場合は原寸維持、それ以外は fit+shrink
        if (settings.noScale || hasCustomSettings) {
            parts.push('noscale');
        } else {
            parts.push('fit', 'shrink');
        }
        return parts.join(',');
    }

    const cleanupTempProcessed = () => {
        if (tempProcessedPath) {
            try { fs.unlinkSync(tempProcessedPath); } catch (_) {}
        }
    };

    if (platform === 'win32') {
        const printMethod = config.printMethod || 'pdf-to-printer';

        if (printMethod === 'sumatra-direct') {
            // SumatraPDFを直接呼び出す方式
            return new Promise((resolve, reject) => {
                const sumatraPath = config.sumatraPdfPath || 'C:\\Users\\jungs\\AppData\\Local\\SumatraPDF\\SumatraPDF.exe';

                // SumatraPDFが存在するか確認
                if (!fs.existsSync(sumatraPath)) {
                    const error = new Error(`SumatraPDF not found at: ${sumatraPath}`);
                    console.error('Print error:', error.message);
                    writeLog(`印刷エラー: SumatraPDFが見つかりません (${sumatraPath})`, 'error');
                    cleanupTempProcessed();
                    reject(error);
                    return;
                }

                const printSettings = buildSumatraSettings();
                console.log(`Printing to ${printerName} using SumatraPDF: ${printFilePath} (${printSettings})`);
                writeLog(`印刷開始 (SumatraPDF直接): ${printerName} [${printSettings}]`, 'info');

                const args = [
                    '-print-to', printerName,
                    '-print-settings', printSettings,
                    printFilePath
                ];

                execFile(sumatraPath, args, (error, stdout, stderr) => {
                    cleanupTempProcessed();
                    if (error) {
                        console.error('SumatraPDF print error:', stderr || error.message);
                        writeLog(`印刷エラー (SumatraPDF): ${error.message}`, 'error');
                        reject(new Error(stderr || error.message));
                    } else {
                        console.log('SumatraPDF print success');
                        writeLog(`印刷完了 (SumatraPDF直接): ${printerName}`, 'success');
                        resolve(stdout);
                    }
                });
            });
        } else {
            // pdf-to-printerライブラリを使う方式（デフォルト）
            try {
                const printSettings = buildSumatraSettings();
                console.log(`Printing to ${printerName} using pdf-to-printer: ${printFilePath} (${printSettings})`);
                writeLog(`印刷開始 (pdf-to-printer): ${printerName} [${printSettings}]`, 'info');

                const result = await printerLib.print(printFilePath, {
                    printer: printerName,
                    win32: [`-print-settings "${printSettings}"`]
                });

                writeLog(`印刷完了 (pdf-to-printer): ${printerName}`, 'success');
                return result;
            } catch (error) {
                console.error('Print error:', error);
                writeLog(`印刷エラー (pdf-to-printer): ${error.message}`, 'error');
                throw error;
            } finally {
                cleanupTempProcessed();
            }
        }
    } else if (platform === 'darwin' || platform === 'linux') {
        // macOS / Linux は lp コマンドを使う
        // pdf-libで向き/サイズ/オフセットを適用済みなので、lpには用紙サイズだけ渡す
        return new Promise((resolve, reject) => {
            // 標準サイズなら media= を指定、カスタムサイズなら Custom.WIDTHxHEIGHTmm 形式
            let mediaOpt;
            if (settings.paperSize === 'auto') {
                mediaOpt = '-o media=A4';
            } else if (settings.paperSize === 'Custom191x131') {
                mediaOpt = '-o media=Custom.191x131mm';
            } else if (settings.paperSize === 'Custom131x191') {
                mediaOpt = '-o media=Custom.131x191mm';
            } else {
                mediaOpt = `-o media=${settings.paperSize}`;
            }
            const cmd = `lp -d "${printerName}" ${mediaOpt} -o sides=one-sided "${printFilePath}"`;
            exec(cmd, (error, stdout, stderr) => {
                cleanupTempProcessed();
                if (error) {
                    console.error('lp error:', stderr || error.message);
                    reject(new Error(stderr || error.message));
                } else {
                    console.log('lp success:', stdout);
                    resolve(stdout);
                }
            });
        });
    } else {
        cleanupTempProcessed();
        throw new Error('Unsupported OS for printing.');
    }
}

// S3ダウンロード
async function downloadFromS3(s3Key) {
    try {
        console.log(`S3ダウンロード開始: bucket=${config.s3.bucket}, key=${s3Key}`);
        const s3 = new S3Client({ region: config.s3.region, credentials: config.s3 });
        const cmd = new GetObjectCommand({ Bucket: config.s3.bucket, Key: s3Key });
        const res = await s3.send(cmd);
        const tmp = path.join(app.getPath('temp'), path.basename(s3Key));
        const ws = fs.createWriteStream(tmp);
        await new Promise((ok, ng) => res.Body.pipe(ws).on('finish', ok).on('error', ng));
        console.log(`S3ダウンロード完了: ${tmp}`);
        return tmp;
    } catch (error) {
        console.error(`S3ダウンロードエラー: bucket=${config.s3.bucket}, key=${s3Key}`, error);
        throw new Error(`S3ダウンロード失敗 (${s3Key}): ${error.message}`);
    }
}

// 並列ダウンロード処理（最大4つ並列）
async function downloadFilesInParallel(jobs) {
    const MAX_CONCURRENT = 4;
    const results = [];

    // ダウンロード処理を実行する関数
    async function downloadJob(job) {
        try {
            const localPath = await downloadFromS3(job.file_url);
            return { ...job, localPath, success: true };
        } catch (err) {
            console.error(`Download failed for ${job.file_url}:`, err);
            writeLog(`ダウンロード失敗: ${job.file_url} - ${err.message}`, 'error');
            return { ...job, localPath: null, success: false, error: err.message };
        }
    }

    // 最大4つずつ並列でダウンロード
    for (let i = 0; i < jobs.length; i += MAX_CONCURRENT) {
        const batch = jobs.slice(i, i + MAX_CONCURRENT);
        const batchResults = await Promise.all(batch.map(downloadJob));
        results.push(...batchResults);
    }

    return results;
}

// ポーリングタスク
async function pollTask() {
    try {
        const ip = getLocalIp();
        const headers = buildApiHeaders();

        // APIエンドポイントを構築
        let apiUrl = `https://${config.apiHost}/api/printer/polling`;

        // warehouse_idが設定されている場合はクエリパラメータとして追加 (v2.0仕様)
        if (config.warehouseId) {
            apiUrl += `?warehouse_id=${parseInt(config.warehouseId)}`;
        }
        console.log('Polling API:', apiUrl);
        console.log('Request headers:', headers);

        const res = await fetch(apiUrl, {
            method: 'GET',
            headers: headers
        });

        console.log('API Response Status:', res.status, res.statusText);
        console.log('API Response Headers:', Object.fromEntries(res.headers.entries()));

        if (!res.ok) {
            // エラーレスポンスの詳細を取得
            let errorDetail = '';
            try {
                const errorBody = await res.text();
                errorDetail = errorBody ? ` - ${errorBody.substring(0, 500)}` : '';
                writeLog(`API エラー (${res.status}): ${errorBody.substring(0, 200)}`, 'error');
                console.error('API Error Response Body:', errorBody.substring(0, 1000));
            } catch (e) {
                console.error('Failed to read error body:', e);
            }
            throw new Error(`HTTP ${res.status} ${res.statusText}${errorDetail}`);
        }

        // Content-Typeを確認
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const textBody = await res.text();
            writeLog(`API エラー: JSON以外のレスポンス (Content-Type: ${contentType})`, 'error');
            console.error('Non-JSON Response:', textBody.substring(0, 500));
            throw new Error(`Expected JSON response but got ${contentType}`);
        }

        const response = await res.json();
        console.log('API Response Body:', JSON.stringify(response).substring(0, 500));
        if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'received', data: response });

        // API エラーチェック
        if (!response.success) {
            const errorMsg = response.debug_message || response.message || 'Unknown error';
            writeLog(`APIエラー: ${errorMsg}`, 'error');
            console.error('API Error Response:', JSON.stringify(response, null, 2));
            return; // エラーの場合は処理を終了
        }

        // レスポンスから実際のデータを取得
        // v2.1: {success: true, data: [...], meta: {...}} 形式
        const data = response.success && response.data && Array.isArray(response.data) ? response.data : null;
        console.log('Parsed data:', data ? `Array with ${data.length} items` : 'null or empty');

        // 印刷ジョブがある場合
        if (data && Array.isArray(data) && data.length > 0) {
            writeLog(`${data.length}個の印刷ジョブを受信しました`, 'info');

            // APIレスポンスを内部形式に変換 (v1.3: printer_index 必須化)
            const jobs = data.map(item => {
                // printer_index はサーバーから必ず受け取る想定。
                // 未指定の場合は警告ログを出して 0 にフォールバック。
                const rawIndex = item.printer_index ?? item.printer_drivers?.printer_index;
                let printerIndex;
                if (rawIndex === undefined || rawIndex === null) {
                    writeLog(
                        `警告: ジョブ ID=${item.id} に printer_index が指定されていません。printer0 にフォールバックします`,
                        'error'
                    );
                    printerIndex = 0;
                } else {
                    printerIndex = Number(rawIndex);
                    if (!Number.isInteger(printerIndex) || printerIndex < 0 || printerIndex >= MAX_PRINTERS) {
                        writeLog(
                            `警告: ジョブ ID=${item.id} の printer_index (${rawIndex}) が範囲外です。printer0 にフォールバックします`,
                            'error'
                        );
                        printerIndex = 0;
                    }
                }

                return {
                    file_id: item.id,
                    print_type: item.print_type,
                    file_url: item.file_path,
                    printer_driver_id: item.printer_driver_id || null,
                    printer_index: printerIndex,
                    routing_type: item.routing_type || 'default',
                    warehouse_id: item.warehouse_id || item.printer_drivers?.warehouse_id,
                    buyer_id: item.buyer_id,
                    buyer_name: item.buyer_name,
                    order: item.order ?? item.id // order指定がなければIDを使用
                };
            });

            // order順にソート
            const sortedJobs = [...jobs].sort((a, b) => a.order - b.order);

            // 並列ダウンロード（最大4つずつ）
            if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'downloading', count: sortedJobs.length });
            writeLog(`${sortedJobs.length}個のファイルをダウンロード中...`, 'info');
            const downloadedJobs = await downloadFilesInParallel(sortedJobs);

            // ダウンロード結果をサマリー表示
            const successCount = downloadedJobs.filter(j => j.success).length;
            const failCount = downloadedJobs.filter(j => !j.success).length;
            if (failCount > 0) {
                writeLog(`ダウンロード結果: 成功=${successCount}, 失敗=${failCount}`, 'error');
            } else {
                writeLog(`ダウンロード完了: ${successCount}個のファイル`, 'success');
            }

            // order順に印刷を実行
            for (const job of downloadedJobs) {
                if (!job.success) {
                    writeLog(`印刷スキップ: ID=${job.file_id} (ダウンロード失敗: ${job.error})`, 'error');
                    continue;
                }

                // v1.3: printer_index でローカル設定を引く（printer_name は無視）
                let printerIndex = Number(job.printer_index);
                let printerName = config[`printer${printerIndex}`];

                // 指定番号のプリンタが未設定の場合、printer0にフォールバック
                if (!printerName && printerIndex !== 0) {
                    writeLog(`プリンタ${printerIndex}が未設定、プリンタ0にフォールバック`, 'info');
                    printerIndex = 0;
                    printerName = config.printer0;
                }

                if (printerName) {
                    writeLog(
                        `印刷開始: ID=${job.file_id}, type=${job.print_type}, ` +
                        `warehouse=${job.warehouse_id}, slot=${printerIndex}, printer=${printerName}`,
                        'info'
                    );

                    let printSuccess = true;
                    let printError = null;

                    try {
                        await printPdf(printerName, job.localPath, printerIndex);
                    } catch (err) {
                        printSuccess = false;
                        printError = err.message;
                        writeLog(`印刷エラー: ID=${job.file_id}, error=${err.message}`, 'error');
                    }

                    // 一時ファイル削除
                    try {
                        fs.unlinkSync(job.localPath);
                    } catch (err) {
                        console.error('Failed to delete temp file:', err);
                    }

                    // 印刷完了報告API (v2.2: POST /api/printer/jobs/{id}/complete)
                    try {
                        const completeUrl = `https://${config.apiHost}/api/printer/jobs/${job.file_id}/complete`;
                        const completeBody = printSuccess
                            ? {
                                status: 'success',
                                printed_at: new Date().toISOString(),
                                printer_name: printerName
                            }
                            : {
                                status: 'error',
                                error_message: printError
                            };

                        await fetch(completeUrl, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify(completeBody)
                        });
                        writeLog(`印刷完了報告: ID=${job.file_id}`, 'info');
                    } catch (err) {
                        writeLog(`印刷完了報告失敗: ID=${job.file_id}, error=${err.message}`, 'error');
                    }

                    if (!printSuccess) {
                        continue; // 次のジョブへ
                    }

                    if (statusWindow) {
                        statusWindow.webContents.send('poll-status', {
                            status: 'printed',
                            file_id: job.file_id,
                            print_type: job.print_type,
                            printer: printerName
                        });
                    }
                    writeLog(`印刷完了: ID=${job.file_id}`, 'success');
                } else {
                    writeLog(`ID ${job.file_id} のプリンタが設定されていません`, 'error');
                }
            }

            writeLog('すべての印刷ジョブが完了しました', 'success');
        }
        // 旧仕様: printer_numberが指定されている場合
        else if (data && data.file && data.printer_number) {
            const printerNum = Number(data.printer_number);
            let printerName = config[`printer${printerNum}`];

            if (!printerName && printerNum !== 0) {
                printerName = config.printer0;
                console.log(`Printer ${printerNum} not configured, falling back to printer0`);
            }

            if (printerName) {
                const localPdf = await downloadFromS3(data.file);
                await printPdf(printerName, localPdf);
                fs.unlinkSync(localPdf);
                if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'printed', printer: printerName });
            } else {
                throw new Error('No printer configured');
            }
        }
        // 旧仕様: data.printerが配列の場合
        else if (data && Array.isArray(data.printer) && data.file) {
            const localPdf = await downloadFromS3(data.file);
            for (const name of data.printer) await printPdf(name, localPdf);
            fs.unlinkSync(localPdf);
            if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'printed' });
        }
    } catch (err) {
        const errorMessage = err?.message || err?.toString() || '不明なエラー';
        writeLog(`ポーリングエラー: ${errorMessage}`, 'error');
        console.error('Poll task error:', err);
    }
}

// ポーリング開始・停止（印刷完了後に次のポーリングを実行する再帰的な実装）
let isPolling = false;

async function pollLoop() {
    if (!isPolling) return;

    try {
        await pollTask();
    } catch (err) {
        const errorMessage = err?.message || err?.toString() || '不明なエラー';
        writeLog(`ポーリングループエラー: ${errorMessage}`, 'error');
        console.error('Poll loop error:', err);
    }

    // 印刷完了後、設定された間隔で次のポーリングをスケジュール
    if (isPolling) {
        pollingTimer = setTimeout(pollLoop, config.pollInterval);
    }
}

function startPolling() {
    if (isPolling) {
        writeLog('ポーリングは既に実行中です', 'info');
        return;
    }

    isPolling = true;
    console.log('Starting polling...');

    // 倉庫IDがある場合は表示、なければクライアントIDで識別
    const identifyBy = config.warehouseId
        ? `倉庫ID: ${config.warehouseId}`
        : `クライアントID: ${config.clientId?.substring(0, 8)}...`;
    writeLog(`ポーリング開始: ${config.apiHost} (間隔: ${config.pollInterval}ms, ${identifyBy})`, 'info');
    pollLoop();
    updateTrayMenu(); // トレイメニューを更新
}

function stopPolling() {
    if (!isPolling) return;
    isPolling = false;
    if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
    }
    console.log('Polling stopped');
    updateTrayMenu(); // トレイメニューを更新
}

// ウィンドウ生成
function createMainWindow() {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        return;
    }
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        icon: path.join(__dirname, 'logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            spellcheck: false
        }
    });
    mainWindow.loadFile('index.html');

    // 開発時のみ DevTools を起動時に自動オープン
    if (!app.isPackaged) {
        mainWindow.webContents.once('did-finish-load', () => {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        });
    }

    // 開発時のみ DevTools を有効化（F12 で開閉、Ctrl+Shift+I でも開閉）
    if (!app.isPackaged) {
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.type === 'keyDown' && (input.key === 'F12'
                || (input.control && input.shift && (input.key === 'I' || input.key === 'i')))) {
                mainWindow.webContents.toggleDevTools();
                event.preventDefault();
            }
        });
    }

    // ウィンドウを閉じる際、非表示にするだけで終了しない
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
    });

    mainWindow.on('closed', () => mainWindow = null);

    // 右クリックメニュー（コンテキストメニュー）を有効化

    mainWindow.webContents.on('context-menu', (e, params) => {
        const { editFlags } = params;
        const hasText = params.selectionText.trim().length > 0;
        const can = (type) => editFlags[`can${type}`] && hasText;

        const menuItems = [];
        if (params.isEditable) {
            menuItems.push(
                { role: 'undo', label: '元に戻す', enabled: editFlags.canUndo },
                { role: 'redo', label: 'やり直す', enabled: editFlags.canRedo },
                { type: 'separator' },
                { role: 'cut', label: '切り取り', enabled: can('Cut') },
                { role: 'copy', label: 'コピー', enabled: can('Copy') },
                { role: 'paste', label: '貼り付け', enabled: editFlags.canPaste },
                { type: 'separator' },
                { role: 'selectAll', label: 'すべて選択' }
            );
        } else {
            menuItems.push(
                { role: 'copy', label: 'コピー', enabled: can('Copy') }
            );
        }

        if (menuItems.length > 0) {
            const contextMenu = Menu.buildFromTemplate(menuItems);
            contextMenu.popup();
        }
    });
}
function createConfigWindow() {
    if (configWindow) return configWindow.focus();
    configWindow = new BrowserWindow({
        width: 500,
        height: 600,
        icon: path.join(__dirname, 'logo.png'),
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    configWindow.loadFile('config.html');
    configWindow.on('closed', () => configWindow = null);
}
function createStatusWindow() {
    if (statusWindow) return statusWindow.focus();
    statusWindow = new BrowserWindow({
        width: 400,
        height: 300,
        icon: path.join(__dirname, 'logo.png'),
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    statusWindow.loadFile('status.html');
    statusWindow.on('closed', () => statusWindow = null);
}

// システムトレイの作成
function createTray() {
    // トレイアイコンの作成（logo.pngを使用、なければデフォルト）
    const iconPath = path.join(__dirname, 'logo.png');
    let trayIcon;

    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
        // Windows用にアイコンをリサイズ
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }

    tray = new Tray(trayIcon || nativeImage.createEmpty());

    // トレイアイコンのツールチップ
    tray.setToolTip('Sakemaru 印刷システム');

    // トレイメニューの作成
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'ウィンドウを表示',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                } else {
                    createMainWindow();
                }
            }
        },
        { type: 'separator' },
        {
            label: isPolling ? 'ポーリング停止' : 'ポーリング開始',
            id: 'polling-toggle',
            click: () => {
                if (isPolling) {
                    stopPolling();
                    writeLog('ポーリングを停止しました（トレイメニューから）', 'info');
                } else {
                    startPolling();
                    writeLog('ポーリングを開始しました（トレイメニューから）', 'success');
                }
                updateTrayMenu();
            }
        },
        { type: 'separator' },
        {
            label: '終了',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    // トレイアイコンをクリックでウィンドウ表示/非表示
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        } else {
            createMainWindow();
        }
    });
}

// トレイメニューを更新
function updateTrayMenu() {
    if (!tray) return;

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'ウィンドウを表示',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                } else {
                    createMainWindow();
                }
            }
        },
        { type: 'separator' },
        {
            label: isPolling ? 'ポーリング停止' : 'ポーリング開始',
            click: () => {
                if (isPolling) {
                    stopPolling();
                    writeLog('ポーリングを停止しました（トレイメニューから）', 'info');
                } else {
                    startPolling();
                    writeLog('ポーリングを開始しました（トレイメニューから）', 'success');
                }
                updateTrayMenu();
            }
        },
        { type: 'separator' },
        {
            label: '終了',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

// システムから利用可能なプリンタ一覧を取得して設定を検証
async function validatePrinterConfiguration() {
    try {
        // メインウィンドウが作成されていない場合はスキップ
        if (!mainWindow) {
            writeLog('メインウィンドウが作成されていないため、プリンタ検証をスキップします', 'info');
            return false;
        }

        // システムから利用可能なプリンタ一覧を取得
        let availablePrinters = [];
        try {
            if (typeof mainWindow.webContents.getPrintersAsync === 'function') {
                availablePrinters = await mainWindow.webContents.getPrintersAsync();
            } else if (typeof mainWindow.webContents.getPrinters === 'function') {
                availablePrinters = mainWindow.webContents.getPrinters();
            } else {
                writeLog('プリンタ取得APIが利用できません', 'error');
                return false;
            }
        } catch (err) {
            writeLog(`プリンタ一覧の取得に失敗: ${err.message}`, 'error');
            return false;
        }

        const printerNames = availablePrinters.map(p => p.name);
        writeLog(`システムから${printerNames.length}台のプリンタを検出しました`, 'info');

        // config.jsonに設定されているプリンタが実際に存在するか確認
        let hasValidPrinter = false;
        for (let i = 0; i < MAX_PRINTERS; i++) {
            const configuredPrinter = config[`printer${i}`];
            if (configuredPrinter) {
                if (printerNames.includes(configuredPrinter)) {
                    writeLog(`プリンタ${i}: ${configuredPrinter} は有効です`, 'info');
                    hasValidPrinter = true;
                } else {
                    writeLog(`警告: プリンタ${i} (${configuredPrinter}) がシステムに見つかりません`, 'error');
                }
            }
        }

        return hasValidPrinter;
    } catch (err) {
        writeLog(`プリンタ設定の検証中にエラーが発生: ${err.message}`, 'error');
        return false;
    }
}

// 起動時の設定チェック関数
function checkAutoStartConditions() {
    // プリンター設定チェック（少なくとも1つのプリンターが設定されているか）
    let hasPrinter = false;
    for (let i = 0; i < MAX_PRINTERS; i++) {
        if (config[`printer${i}`]) {
            hasPrinter = true;
            break;
        }
    }

    // API設定チェック
    const hasApiHost = config.apiHost && config.apiHost.trim() !== '';

    // クライアントIDチェック（倉庫未設定時はクライアントIDで識別）
    const hasClientId = config.clientId && config.clientId.trim() !== '';

    return hasPrinter && hasApiHost && hasClientId;
}

// メニューバー設定 & アプリ起動
app.whenReady().then(() => {
    console.log('Application starting...');
    console.log('Loaded configuration:');
    console.log('  API Host:', config.apiHost);
    console.log('  Poll Interval:', config.pollInterval);
    console.log('  Printer0:', config.printer0 || '(未設定)');
    console.log('  Printer1:', config.printer1 || '(未設定)');
    console.log('  Printer2:', config.printer2 || '(未設定)');
    console.log('  Printer3:', config.printer3 || '(未設定)');

    const template = [
        {
            label: app.name,
            submenu: [
                { label: 'ホーム', click: createMainWindow },
                { type: 'separator' },
                { label: '終了', click: () => app.quit() }
            ]
        },
        {
            label: '編集',
            submenu: [
                { role: 'undo', label: '元に戻す' },
                { role: 'redo', label: 'やり直す' },
                { type: 'separator' },
                { role: 'cut', label: '切り取り' },
                { role: 'copy', label: 'コピー' },
                { role: 'paste', label: '貼り付け' },
                { role: 'selectAll', label: 'すべて選択' }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    // システムトレイを作成
    createTray();

    // 初回表示
    createMainWindow();

    // Windows自動起動の設定（ビルド済みアプリのみ）
    if (app.isPackaged) {
        autoLauncher.isEnabled().then((isEnabled) => {
            if (!isEnabled) {
                autoLauncher.enable().then(() => {
                    console.log('Auto-launch enabled');
                    writeLog('Windows起動時の自動起動を有効にしました', 'info');
                }).catch((err) => {
                    console.error('Failed to enable auto-launch:', err);
                });
            } else {
                console.log('Auto-launch already enabled');
            }
        }).catch((err) => {
            console.error('Failed to check auto-launch status:', err);
        });
    }

    // 起動時の自動ポーリング開始チェック
    if (checkAutoStartConditions()) {
        // ウィンドウ作成後、プリンタ検証を実行してからポーリング開始
        setTimeout(async () => {
            writeLog('プリンタ設定を検証しています...', 'info');
            const isValid = await validatePrinterConfiguration();

            if (isValid) {
                writeLog('プリンタ設定が正常です。ポーリングを自動開始します', 'info');
                startPolling();
                writeLog('ポーリングを開始しました', 'success');
            } else {
                writeLog('プリンタ設定に問題があります。設定を確認してください', 'error');
            }
        }, 1000);
    } else {
        writeLog('設定が不足しています。プリンター、APIの設定を確認してください', 'error');
    }
});

// すべてのウィンドウが閉じられても、バックグラウンドで動作を継続
app.on('window-all-closed', (event) => {
    // macOSでも終了しないように変更
    // バックグラウンドでポーリングを継続
    event.preventDefault();
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

// アプリ終了前の処理
app.on('before-quit', () => {
    app.isQuitting = true;

    // ポーリングを停止
    stopPolling();
    writeLog('アプリケーションを終了します...', 'info');

    // 現在の設定を保存
    saveConfigToFile();
    writeLog('設定を保存しました', 'info');
});

// IPC ハンドラ
ipcMain.handle('get-printers', async (e) => {
    try {
        const wc = e.sender;

        // 最新のElectronではwebContents.getPrintersAsync()を使用
        if (typeof wc.getPrintersAsync === 'function') {
            console.log('Using wc.getPrintersAsync()');
            return await wc.getPrintersAsync();
        }

        // 古いバージョンではgetPrinters()
        if (typeof wc.getPrinters === 'function') {
            console.log('Using wc.getPrinters()');
            return wc.getPrinters();
        }

        // BrowserWindowから取得を試みる
        const win = BrowserWindow.fromWebContents(wc);
        if (win && typeof win.webContents.getPrintersAsync === 'function') {
            console.log('Using BrowserWindow.webContents.getPrintersAsync()');
            return await win.webContents.getPrintersAsync();
        }

        throw new Error('No printer API available');
    } catch (err) {
        console.error('get-printers error:', err);
        throw err;
    }
});
ipcMain.handle('print-to-printer', (_e, args) => printPdf(args.printerName, args.filePath));
ipcMain.handle('load-config', async () => JSON.parse(fs.readFileSync(configPath, 'utf-8')));
ipcMain.handle('save-config', async (_e, newCfg) => {
    writeLog('設定を保存しています...', 'info');

    // 設定を更新（clientId と printerSettings は保持）
    const clientId = config.clientId;
    const prevPrinterSettings = config.printerSettings || {};
    config = newCfg;
    config.clientId = clientId;
    // newCfg に printerSettings が含まれていれば優先、なければ既存を維持
    if (!config.printerSettings) {
        config.printerSettings = prevPrinterSettings;
    }

    // ファイルに保存
    if (!saveConfigToFile()) {
        writeLog('設定の保存に失敗しました', 'error');
        return false;
    }

    writeLog(`API設定を更新: ${config.apiHost}`, 'info');

    // ポーリングを停止（自動再開はしない）
    if (isPolling) {
        stopPolling();
        writeLog('ポーリングを停止しました（設定保存のため）', 'info');
    }

    writeLog('設定を保存しました。ポーリングは手動で開始してください。', 'success');

    return true;
});
ipcMain.handle('start-polling', () => { startPolling(); return true; });
ipcMain.handle('stop-polling',  () => { stopPolling();  return true; });
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

// プロファイル情報を取得（現在のプロファイルと利用可能なプロファイル一覧）
ipcMain.handle('get-profile-info', async () => {
    return {
        active: activeProfile,
        profiles: VALID_PROFILES.map(p => ({
            id: p,
            label: p === 'prod' ? '本番' : 'ステージング',
            hasTemplate: fs.existsSync(getTemplateConfigPath(p)),
            hasUserFile: fs.existsSync(getUserConfigPath(p))
        }))
    };
});

// プロファイルを切り替える
ipcMain.handle('switch-profile', async (_e, newProfile) => {
    if (!VALID_PROFILES.includes(newProfile)) {
        return { success: false, error: `不正なプロファイル: ${newProfile}` };
    }
    if (newProfile === activeProfile) {
        return { success: true, profile: activeProfile, message: '既に有効' };
    }

    // ポーリングを停止
    if (isPolling) {
        stopPolling();
        writeLog(`プロファイル切替のためポーリングを停止しました`, 'info');
    }

    // 現在の設定を保存（プロファイル切替前に確実に保持）
    saveConfigToFile();

    // 新プロファイルに切替
    activeProfile = newProfile;
    configPath = getUserConfigPath(activeProfile);
    config = loadConfigForProfile(activeProfile);
    saveActiveProfile(activeProfile);

    const label = activeProfile === 'prod' ? '本番' : 'ステージング';
    writeLog(`プロファイルを切替えました: ${label} (${activeProfile})`, 'success');

    // すべての開いているウィンドウに通知
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('profile-changed', {
            profile: activeProfile,
            label
        });
    });

    return { success: true, profile: activeProfile, label };
});
ipcMain.handle('download-sample-pdf', async () => {
    // S3からvouchers/sample.pdfをダウンロード
    return downloadFromS3('vouchers/sample.pdf');
});

// PDFファイル選択ダイアログ
ipcMain.handle('pick-pdf-file', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    const result = await dialog.showOpenDialog(win, {
        title: 'テスト印刷するPDFを選択',
        properties: ['openFile'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});

// テスト印刷（モーダルで入力中の設定値で印刷）
ipcMain.handle('test-print-with-settings', async (_e, { printerName, filePath, settings }) => {
    if (!printerName) throw new Error('プリンタが指定されていません');
    if (!filePath) throw new Error('PDFファイルが指定されていません');
    if (!fs.existsSync(filePath)) throw new Error(`ファイルが見つかりません: ${filePath}`);

    writeLog(`テスト印刷開始: printer=${printerName}, file=${path.basename(filePath)}`, 'info');
    await printPdf(printerName, filePath, null, settings || null);
    writeLog(`テスト印刷完了: printer=${printerName}`, 'success');
    return true;
});

// プリンタリスト同期 (v2.2: POST /api/printer/warehouses/{id}/printers/sync)
ipcMain.handle('sync-printers', async (_e, { warehouseId, printers }) => {
    try {
        if (!config.apiHost) {
            return { success: false, error: 'APIホストが設定されていません' };
        }

        if (!warehouseId) {
            return { success: false, error: '倉庫IDが指定されていません' };
        }

        const apiUrl = `https://${config.apiHost}/api/printer/warehouses/${warehouseId}/printers/sync`;
        const headers = buildApiHeaders();

        console.log('Syncing printers to:', apiUrl);
        console.log('Printers:', JSON.stringify(printers));

        const requestBody = {
            client_uuid: config.clientId,
            printers: printers
        };
        console.log('Sync request body:', JSON.stringify(requestBody));

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(15000) // 15秒タイムアウト
        });

        if (!res.ok) {
            const errorText = await res.text();
            writeLog(`プリンタ同期エラー: HTTP ${res.status}`, 'error');
            return {
                success: false,
                status: res.status,
                error: `HTTP ${res.status}: ${res.statusText}`,
                details: errorText.substring(0, 500)
            };
        }

        const result = await res.json();

        if (result.success) {
            writeLog(`プリンタ同期完了: ${result.data?.synced_count || 0}台`, 'success');
        }

        return result;

    } catch (err) {
        console.error('Printer sync error:', err);
        writeLog(`プリンタ同期エラー: ${err.message}`, 'error');

        let errorMessage = err.message;
        if (err.name === 'AbortError' || err.message.includes('timeout')) {
            errorMessage = '接続タイムアウト: サーバーに接続できません';
        }

        return {
            success: false,
            error: errorMessage,
            details: err.stack
        };
    }
});

// API接続テスト (v2.1: GET /api/printer/test エンドポイント使用)
ipcMain.handle('test-api-connection', async (_e, testConfig) => {
    try {
        // clientIdが未設定の場合は再生成
        if (!config.clientId) {
            config.clientId = generateClientId();
            saveConfigToFile();
            console.log('Regenerated client ID for test:', config.clientId);
        }

        const apiUrl = `https://${testConfig.apiHost}/api/printer/test`;
        const headers = {
            'Content-Type': 'application/json',
            'X-Client-Id': config.clientId
        };

        if (testConfig.apiToken) {
            headers['Authorization'] = `Bearer ${testConfig.apiToken}`;
        }

        console.log('Test API - X-Client-Id:', config.clientId);

        console.log('Testing API connection to:', apiUrl);

        const res = await fetch(apiUrl, {
            method: 'GET',
            headers: headers,
            signal: AbortSignal.timeout(10000) // 10秒タイムアウト
        });

        if (!res.ok) {
            const errorText = await res.text();
            return {
                success: false,
                status: res.status,
                statusText: res.statusText,
                error: `HTTP ${res.status}: ${res.statusText}`,
                details: errorText.substring(0, 500) // 最初の500文字のみ
            };
        }

        // 正常なレスポンス - サーバー情報を取得
        const result = await res.json();
        const serverInfo = result.success && result.data ? result.data : {};

        return {
            success: true,
            status: res.status,
            message: 'API接続に成功しました',
            serverVersion: serverInfo.server_version || 'unknown',
            clientId: serverInfo.client_id || null,
            timestamp: serverInfo.timestamp || null
        };

    } catch (err) {
        console.error('API connection test error:', err);

        let errorMessage = err.message;
        if (err.name === 'AbortError' || err.message.includes('timeout')) {
            errorMessage = '接続タイムアウト: APIサーバーに接続できません (10秒以内に応答がありませんでした)';
        } else if (err.message.includes('fetch failed') || err.message.includes('ENOTFOUND')) {
            errorMessage = 'ホスト名が解決できません: APIホストが正しいか確認してください';
        } else if (err.message.includes('ECONNREFUSED')) {
            errorMessage = '接続が拒否されました: APIサーバーが起動していない可能性があります';
        }

        return {
            success: false,
            error: errorMessage,
            details: err.stack
        };
    }
});
