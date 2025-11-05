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
app.name = 'BZPrinter';

// 設定ファイルパス
const configPath = path.join(__dirname, 'config.json');
let config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

let mainWindow;
let configWindow;
let statusWindow;
let pollingTimer = null;

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

// ポーリングタスク
async function pollTask() {
    try {
        const ip = getLocalIp();
        const res = await fetch(config.apiAddress, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ printer_pc_id: ip })
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'received', data });
        if (Array.isArray(data.printer) && data.file) {
            const localPdf = await downloadFromS3(data.file);
            for (const name of data.printer) await printPdf(name, localPdf);
            fs.unlinkSync(localPdf);
            if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'printed' });
        }
    } catch (err) {
        console.error('Polling error:', err);
        if (statusWindow) statusWindow.webContents.send('poll-status', { status: 'error', error: err.message });
    }
}

// ポーリング開始・停止
function startPolling() {
    if (pollingTimer) return;
    pollingTimer = setInterval(pollTask, config.pollInterval);
}
function stopPolling() {
    if (!pollingTimer) return;
    clearInterval(pollingTimer);
    pollingTimer = null;
}

// ウィンドウ生成
function createMainWindow() {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        return;
    }
    mainWindow = new BrowserWindow({ width: 500, height: 600, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
    mainWindow.loadFile('index.html');
    mainWindow.on('closed', () => mainWindow = null);
}
function createConfigWindow() {
    if (configWindow) return configWindow.focus();
    configWindow = new BrowserWindow({ width: 500, height: 600, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
    configWindow.loadFile('config.html');
    configWindow.on('closed', () => configWindow = null);
}
function createStatusWindow() {
    if (statusWindow) return statusWindow.focus();
    statusWindow = new BrowserWindow({ width: 400, height: 300, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
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
                { label: '設定', click: createConfigWindow },
                { label: '通信状況', click: createStatusWindow },
                { type: 'separator' },
                { label: '終了', click: () => app.quit() }
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
ipcMain.handle('sync-printers', async (_e, list) => {
    await fetch(config.syncApiAddress, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ printer_pc_id: getLocalIp(), printer_list: list }) });
    return true;
});
