// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // メインウィンドウ向け
    getPrinters:      () => ipcRenderer.invoke('get-printers'),
    printToPrinter:   (name, path) => ipcRenderer.invoke('print-to-printer', { printerName: name, filePath: path }),
    startPolling:     () => ipcRenderer.invoke('start-polling'),
    stopPolling:      () => ipcRenderer.invoke('stop-polling'),
    downloadSamplePdf: () => ipcRenderer.invoke('download-sample-pdf'),
    getAppVersion:    () => ipcRenderer.invoke('get-app-version'),

    // 設定ウィンドウ向け
    loadConfig:       () => ipcRenderer.invoke('load-config'),
    saveConfig:       (cfg) => ipcRenderer.invoke('save-config', cfg),
    testApiConnection: (cfg) => ipcRenderer.invoke('test-api-connection', cfg),

    // プリンタ同期 (v2.2)
    syncPrinters:     (warehouseId, printers) => ipcRenderer.invoke('sync-printers', { warehouseId, printers }),

    // ステータスウィンドウ向け：ポーリング状況を受け取る
    onPollStatus:     (callback) => ipcRenderer.on('poll-status', (_e, data) => callback(data)),
});
