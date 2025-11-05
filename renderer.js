// renderer.js
window.addEventListener('DOMContentLoaded', () => {
    // --- メインウィンドウ用処理（index.html） ---
    if (document.getElementById('btn-load')) {
        // プリンタ一覧取得
        document.getElementById('btn-load').addEventListener('click', async () => {
            try {
                const ps = await window.electronAPI.getPrinters();
                const sel = document.getElementById('printer-list');
                sel.innerHTML = '';
                ps.forEach(p => {
                    const o = document.createElement('option');
                    o.value = p.name;
                    o.textContent = p.name + (p.isDefault ? ' (Default)' : '');
                    sel.appendChild(o);
                });
            } catch {
                alert('プリンタ一覧取得に失敗');
            }
        });

        // 手動印刷
        document.getElementById('btn-print').addEventListener('click', async () => {
            const sel = document.getElementById('printer-list');
            const file = document.getElementById('manual-file').value;
            if (!sel.value) return alert('プリンタを選択してください');
            try {
                await window.electronAPI.printToPrinter(sel.value, file);
                alert('印刷完了');
            } catch (e) {
                alert('印刷失敗: ' + e.message);
            }
        });

        // SYNC
        document.getElementById('btn-sync').addEventListener('click', async () => {
            const ps = await window.electronAPI.getPrinters();
            const names = ps.map(p => p.name);
            await window.electronAPI.syncPrinters(names);
            alert('同期完了');
        });

        // ポーリング開始・停止
        document.getElementById('btn-start').addEventListener('click', () => {
            window.electronAPI.startPolling();
            alert('ポーリング開始');
        });
        document.getElementById('btn-stop').addEventListener('click', () => {
            window.electronAPI.stopPolling();
            alert('ポーリング停止');
        });
    }

    // --- 設定ウィンドウ用処理（config.html） ---
    if (document.getElementById('cfg-pollInterval')) {
        const elems = {
            pollInterval:      document.getElementById('cfg-pollInterval'),
            apiAddress:        document.getElementById('cfg-apiAddress'),
            syncApiAddress:    document.getElementById('cfg-syncApiAddress'),
            s3: {
                bucket:          document.getElementById('cfg-s3-bucket'),
                region:          document.getElementById('cfg-s3-region'),
                accessKeyId:     document.getElementById('cfg-s3-accessKeyId'),
                secretAccessKey: document.getElementById('cfg-s3-secretAccessKey'),
            },
            saveBtn:           document.getElementById('btn-save-config'),
        };

        // 読み込み
        window.electronAPI.loadConfig().then(cfg => {
            elems.pollInterval.value       = cfg.pollInterval;
            elems.apiAddress.value         = cfg.apiAddress;
            elems.syncApiAddress.value     = cfg.syncApiAddress;
            elems.s3.bucket.value          = cfg.s3.bucket;
            elems.s3.region.value          = cfg.s3.region;
            elems.s3.accessKeyId.value     = cfg.s3.accessKeyId;
            elems.s3.secretAccessKey.value = cfg.s3.secretAccessKey;
        }).catch(() => alert('設定読み込み失敗'));

        // 保存
        elems.saveBtn.addEventListener('click', () => {
            const newCfg = {
                pollInterval:   Number(elems.pollInterval.value),
                apiAddress:     elems.apiAddress.value,
                syncApiAddress: elems.syncApiAddress.value,
                s3: {
                    bucket:          elems.s3.bucket.value,
                    region:          elems.s3.region.value,
                    accessKeyId:     elems.s3.accessKeyId.value,
                    secretAccessKey: elems.s3.secretAccessKey.value,
                },
            };
            window.electronAPI.saveConfig(newCfg)
                .then(() => alert('設定を保存しました'))
                .catch(() => alert('設定保存に失敗しました'));
        });
    }

    // --- 通信状況ウィンドウ用処理（status.html） ---
    if (document.getElementById('status-log')) {
        const logEl = document.getElementById('status-log');
        window.electronAPI.onPollStatus(data => {
            const ts = new Date().toLocaleTimeString();
            let msg = '';
            if (data.status === 'received')      msg = `[${ts}] タスク取得: ${JSON.stringify(data.data)}\n`;
            else if (data.status === 'printed')  msg = `[${ts}] 印刷完了\n`;
            else if (data.status === 'error')    msg = `[${ts}] エラー: ${data.error}\n`;
            logEl.textContent += msg;
            logEl.scrollTop = logEl.scrollHeight;
        });
    }
});
