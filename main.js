// main.js
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fetch = global.fetch; // Node18+ のグローバル fetch
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { exec } = require('child_process');
const printerLib = require('pdf-to-printer'); // 追加が必要
// アプリケーション名を設定
app.name = '酒まる印刷';

// 設定ファイルパス
const configPath = path.join(__dirname, 'config.json');
let config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

let mainWindow;
let configWindow;
let statusWindow;
let pollingTimer = null;

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
        // Windows は pdf-to-printer を使う
        return printerLib.print(localFilePath, {
            printer: printerName,
            win32: ['-print-settings "fit"']
        });
    } else if (platform === 'darwin' || platform === 'linux') {
        // macOS / Linux は lp コマンドを使う
        return new Promise((resolve, reject) => {
            const cmd = `lp -d "${printerName}" "${localFilePath}"`;
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

        const res = await fetch(config.apiAddress, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ printer_pc_id: ip })
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'received', data });

        // 新仕様（指示５）: 配列形式のジョブリスト
        if (Array.isArray(data) && data.length > 0) {
            writeLog(`${data.length}個の印刷ジョブを受信しました`, 'info');

            // order順にソート
            const sortedJobs = [...data].sort((a, b) => a.order - b.order);

            // 並列ダウンロード（最大4つずつ）
            if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'downloading', count: sortedJobs.length });
            writeLog(`${sortedJobs.length}個のファイルをダウンロード中...`, 'info');
            const downloadedJobs = await downloadFilesInParallel(sortedJobs);

            // order順に印刷を実行
            for (const job of downloadedJobs) {
                if (!job.success) {
                    writeLog(`order ${job.order} のダウンロードに失敗、印刷をスキップ`, 'error');
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
                    writeLog(`印刷開始: order=${job.order}, file_id=${job.file_id}, printer=${printerName}`, 'info');
                    await printPdf(printerName, job.localPath);
                    fs.unlinkSync(job.localPath);
                    if (statusWindow) {
                        statusWindow.webContents.send('poll-status', {
                            status: 'printed',
                            order: job.order,
                            file_id: job.file_id,
                            printer: printerName
                        });
                    }
                    writeLog(`印刷完了: order=${job.order}, file_id=${job.file_id}`, 'success');
                } else {
                    writeLog(`order ${job.order} のプリンタが設定されていません`, 'error');
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
        writeLog(`ポーリングエラー: ${err.message}`, 'error');
        if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'error', error: err.message });
    }
}

// ポーリング開始・停止（印刷完了後に次のポーリングを実行する再帰的な実装）
let isPolling = false;

async function pollLoop() {
    if (!isPolling) return;

    try {
        await pollTask();
    } catch (err) {
        console.error('Poll loop error:', err);
    }

    // 印刷完了後、設定された間隔で次のポーリングをスケジュール
    if (isPolling) {
        pollingTimer = setTimeout(pollLoop, config.pollInterval);
    }
}

function startPolling() {
    if (isPolling) return;
    isPolling = true;
    console.log('Starting polling...');
    pollLoop();
}

function stopPolling() {
    if (!isPolling) return;
    isPolling = false;
    if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
    }
    console.log('Polling stopped');
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
        height: 1100,
        icon: path.join(__dirname, 'logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            spellcheck: false
        }
    });
    mainWindow.loadFile('index.html');
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

// メニューバー設定 & アプリ起動
app.whenReady().then(() => {
    const template = [
        {
            label: app.name,
            submenu: [
                { label: 'ホーム', click: createMainWindow },
                { type: 'separator' },
                { label: '開始', click: startPolling },
                { label: '停止', click: stopPolling },
                { type: 'separator' },
                { label: '通信状況', click: createStatusWindow },
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
    // 初回表示
    createMainWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

// IPC ハンドラ
ipcMain.handle('get-printers', async (e) => {
    const wc = e.sender;
    if (wc.getPrintersAsync) return wc.getPrintersAsync();
    if (wc.getPrinters)       return wc.getPrinters();
    return BrowserWindow.fromWebContents(wc).webContents.getPrintersAsync();
});
ipcMain.handle('print-to-printer', (_e, args) => printPdf(args.printerName, args.filePath));
ipcMain.handle('load-config', async () => JSON.parse(fs.readFileSync(configPath, 'utf-8')));
ipcMain.handle('save-config', async (_e, newCfg) => {
    fs.writeFileSync(configPath, JSON.stringify(newCfg, null, 2));
    config = newCfg;
    stopPolling();
    startPolling();
    return true;
});
ipcMain.handle('start-polling', () => { startPolling(); return true; });
ipcMain.handle('stop-polling',  () => { stopPolling();  return true; });
ipcMain.handle('download-sample-pdf', async () => {
    // S3からlocal_print_test/sample.pdfをダウンロード
    return downloadFromS3('local_print_test/sample.pdf');
});
