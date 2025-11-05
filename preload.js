// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // メインウィンドウ向け
    getPrinters:      () => ipcRenderer.invoke('get-printers'),
    printToPrinter:   (name, path) => ipcRenderer.invoke('print-to-printer', { printerName: name, filePath: path }),
    startPolling:     () => ipcRenderer.invoke('start-polling'),
    stopPolling:      () => ipcRenderer.invoke('stop-polling'),
    syncPrinters:     (list) => ipcRenderer.invoke('sync-printers', list),

    // 設定ウィンドウ向け
    loadConfig:       () => ipcRenderer.invoke('load-config'),
    saveConfig:       (cfg) => ipcRenderer.invoke('save-config', cfg),

    // ステータスウィンドウ向け：ポーリング状況を受け取る
    onPollStatus:     (callback) => ipcRenderer.on('poll-status', (_e, data) => callback(data)),
});
