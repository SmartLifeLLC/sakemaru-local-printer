// main.js
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fetch = global.fetch; // Node18+ のグローバル fetch
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { exec, execFile } = require('child_process');
const printerLib = require('pdf-to-printer'); // 追加が必要
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
const configPath = path.join(userDataPath, 'config.json');

// デフォルト設定
const defaultConfig = {
    pollInterval: 5000,
    apiHost: '',
    apiToken: '',
    warehouseId: '', // 倉庫ID（オプション、指定すると該当倉庫の印刷ジョブのみ取得）
    printer0: '',
    printer1: '',
    printer2: '',
    printer3: '',
    printMethod: 'pdf-to-printer', // 'pdf-to-printer' or 'sumatra-direct'
    sumatraPdfPath: 'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    s3: {
        bucket: '',
        region: 'ap-northeast-1',
        accessKeyId: '',
        secretAccessKey: ''
    }
};

// 設定ファイルを読み込む（存在しない場合はデフォルト設定で作成）
let config;
if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log('Configuration loaded from:', configPath);
} else {
    // 開発時用: プロジェクトルートのconfig.jsonをコピー
    const devConfigPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(devConfigPath)) {
        config = JSON.parse(fs.readFileSync(devConfigPath, 'utf-8'));
        console.log('Configuration copied from development config:', devConfigPath);
    } else {
        config = defaultConfig;
        console.log('Using default configuration');
    }
    // ユーザーデータディレクトリに保存
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('Configuration saved to:', configPath);
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
            status: type === 'error' ? 'error' : 'log',
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


async function printPdf(printerName, localFilePath) {
    const platform = os.platform();

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
                    reject(error);
                    return;
                }

                console.log(`Printing to ${printerName} using SumatraPDF: ${localFilePath}`);
                writeLog(`印刷開始 (SumatraPDF直接): ${printerName}`, 'info');

                const args = [
                    '-print-to', printerName,
                    '-print-settings', 'paper=A4,fit',
                    localFilePath
                ];

                execFile(sumatraPath, args, (error, stdout, stderr) => {
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
                console.log(`Printing to ${printerName} using pdf-to-printer: ${localFilePath}`);
                writeLog(`印刷開始 (pdf-to-printer): ${printerName}`, 'info');

                const result = await printerLib.print(localFilePath, {
                    printer: printerName,
                    win32: ['-print-settings "paper=A4,fit,shrink"']
                });

                writeLog(`印刷完了 (pdf-to-printer): ${printerName}`, 'success');
                return result;
            } catch (error) {
                console.error('Print error:', error);
                writeLog(`印刷エラー (pdf-to-printer): ${error.message}`, 'error');
                throw error;
            }
        }
    } else if (platform === 'darwin' || platform === 'linux') {
        // macOS / Linux は lp コマンドを使う（A4用紙サイズを指定）
        return new Promise((resolve, reject) => {
            const cmd = `lp -d "${printerName}" -o media=A4 "${localFilePath}"`;
            exec(cmd, (error, stdout, stderr) => {
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
        throw new Error('Unsupported OS for printing.');
    }
}

// S3ダウンロード
async function downloadFromS3(s3Key) {
    const s3 = new S3Client({ region: config.s3.region, credentials: config.s3 });
    const cmd = new GetObjectCommand({ Bucket: config.s3.bucket, Key: s3Key });
    const res = await s3.send(cmd);
    const tmp = path.join(app.getPath('temp'), path.basename(s3Key));
    const ws = fs.createWriteStream(tmp);
    await new Promise((ok, ng) => res.Body.pipe(ws).on('finish', ok).on('error', ng));
    return tmp;
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
        const headers = { 'Content-Type': 'application/json' };

        // Bearer認証トークンが設定されている場合は追加
        if (config.apiToken) {
            headers['Authorization'] = `Bearer ${config.apiToken}`;
        }

        // APIエンドポイントを構築
        const apiUrl = `https://${config.apiHost}/api/printer/polling`;

        // warehouse_idが設定されている場合のみリクエストボディに含める
        const requestBody = {};
        if (config.warehouseId) {
            requestBody.warehouse_id = parseInt(config.warehouseId);
        }
        console.log('Polling API:', apiUrl);
        console.log('Request body:', JSON.stringify(requestBody));
        console.log('Request headers:', headers);

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
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
        if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'received', data: response });

        // レスポンスから実際のデータを取得
        const data = response.success && response.data && response.data.data ? response.data.data : null;

        // 新API形式: {success: true, data: {data: [...]}} の場合
        if (data && Array.isArray(data) && data.length > 0) {
            writeLog(`${data.length}個の印刷ジョブを受信しました`, 'info');

            // APIレスポンスを内部形式に変換
            const jobs = data.map(item => ({
                file_id: item.id,
                print_type: item.print_type,
                file_url: item.file_path,
                printer_id: item.printer_drivers?.printer_id ?? 0, // サーバーから送られたprinter_idを使用
                warehouse_id: item.printer_drivers?.warehouse_id,
                order: item.id // IDを順序として使用
            }));

            // order順にソート
            const sortedJobs = [...jobs].sort((a, b) => a.order - b.order);

            // 並列ダウンロード（最大4つずつ）
            if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'downloading', count: sortedJobs.length });
            writeLog(`${sortedJobs.length}個のファイルをダウンロード中...`, 'info');
            const downloadedJobs = await downloadFilesInParallel(sortedJobs);

            // order順に印刷を実行
            for (const job of downloadedJobs) {
                if (!job.success) {
                    writeLog(`ID ${job.file_id} のダウンロードに失敗、印刷をスキップ`, 'error');
                    continue;
                }

                const printerNum = Number(job.printer_id);
                let printerName = config[`printer${printerNum}`];

                // 指定番号のプリンタが未設定の場合、printer0にフォールバック
                if (!printerName && printerNum !== 0) {
                    printerName = config.printer0;
                    writeLog(`プリンタ${printerNum}が未設定、プリンタ0にフォールバック`, 'info');
                }

                if (printerName) {
                    writeLog(`印刷開始: ID=${job.file_id}, type=${job.print_type}, warehouse=${job.warehouse_id}, printer=${printerName}`, 'info');
                    await printPdf(printerName, job.localPath);
                    fs.unlinkSync(job.localPath);

                    // ステータス更新APIを呼び出し
                    try {
                        const statusUpdateUrl = `https://${config.apiHost}/api/printer/document-${job.print_type}-status`;
                        await fetch(statusUpdateUrl, {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ id: job.file_id, status: 'END' })
                        });
                        writeLog(`ステータス更新完了: ID=${job.file_id}`, 'info');
                    } catch (err) {
                        writeLog(`ステータス更新失敗: ID=${job.file_id}, error=${err.message}`, 'error');
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
        else if (data.file && data.printer_number) {
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
        else if (Array.isArray(data.printer) && data.file) {
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
    writeLog(`ポーリング開始: ${config.apiHost} (間隔: ${config.pollInterval}ms)`, 'info');
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
        for (let i = 0; i < 4; i++) {
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
    const hasPrinter = config.printer0 || config.printer1 || config.printer2 || config.printer3;

    // API設定チェック
    const hasApiHost = config.apiHost && config.apiHost.trim() !== '';

    return hasPrinter && hasApiHost;
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
        writeLog('プリンターまたはAPI設定が不足しています。設定を確認してください', 'error');
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

    // 設定を更新
    config = newCfg;

    // ファイルに保存
    if (!saveConfigToFile()) {
        writeLog('設定の保存に失敗しました', 'error');
        return false;
    }

    writeLog(`API設定を更新: ${config.apiHost}`, 'info');

    // ポーリングを停止
    stopPolling();
    writeLog('ポーリングを停止しました', 'info');

    // 少し待ってからポーリング再開
    setTimeout(() => {
        startPolling();
        writeLog('新しい設定でポーリングを再開しました', 'success');
    }, 500);

    return true;
});
ipcMain.handle('start-polling', () => { startPolling(); return true; });
ipcMain.handle('stop-polling',  () => { stopPolling();  return true; });
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});
ipcMain.handle('download-sample-pdf', async () => {
    // S3からvouchers/sample.pdfをダウンロード
    return downloadFromS3('vouchers/sample.pdf');
});

// API接続テスト
ipcMain.handle('test-api-connection', async (_e, testConfig) => {
    try {
        const apiUrl = `https://${testConfig.apiHost}/api/printer/tasks`;
        const ip = getLocalIp();
        const headers = { 'Content-Type': 'application/json' };

        if (testConfig.apiToken) {
            headers['Authorization'] = `Bearer ${testConfig.apiToken}`;
        }

        console.log('Testing API connection to:', apiUrl);

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ printer_pc_id: ip }),
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

        // 正常なレスポンス
        return {
            success: true,
            status: res.status,
            message: 'API接続に成功しました'
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
