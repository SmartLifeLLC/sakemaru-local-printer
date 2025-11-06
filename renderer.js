// renderer.js
window.addEventListener('DOMContentLoaded', () => {
    // タブ切り替え機能
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');

            // すべてのタブとコンテンツから active を削除
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));

            // クリックされたタブとコンテンツに active を追加
            tab.classList.add('active');
            document.getElementById(`tab-${targetTab}`).classList.add('active');
        });
    });

    // --- メインウィンドウ用処理（index.html） ---
    if (document.getElementById('btn-load')) {
        const printerSelects = [
            document.getElementById('printer1'),
            document.getElementById('printer2'),
            document.getElementById('printer3'),
            document.getElementById('printer4'),
            document.getElementById('test-printer')
        ];

        // プリンタ一覧を読み込んで設定を反映する関数
        async function loadPrintersAndApplyConfig(showAlert = false) {
            try {
                // 保存済みの設定を取得
                const cfg = await window.electronAPI.loadConfig();
                const savedPrinters = {
                    printer1: cfg.printer1 || '',
                    printer2: cfg.printer2 || '',
                    printer3: cfg.printer3 || '',
                    printer4: cfg.printer4 || ''
                };

                // プリンタ一覧を取得
                const ps = await window.electronAPI.getPrinters();

                // すべてのselectに反映
                printerSelects.forEach((sel, index) => {
                    sel.innerHTML = '<option value="">（未設定）</option>';
                    ps.forEach(p => {
                        const o = document.createElement('option');
                        o.value = p.name;
                        o.textContent = p.name + (p.isDefault ? ' (Default)' : '');
                        sel.appendChild(o);
                    });
                });

                // 保存済みの設定を反映
                document.getElementById('printer1').value = savedPrinters.printer1;
                document.getElementById('printer2').value = savedPrinters.printer2;
                document.getElementById('printer3').value = savedPrinters.printer3;
                document.getElementById('printer4').value = savedPrinters.printer4;

                if (showAlert) {
                    alert('プリンタ一覧を読み込みました');
                }
            } catch (err) {
                console.error('プリンタ一覧取得エラー:', err);
                if (showAlert) {
                    alert('プリンタ一覧取得に失敗');
                }
            }
        }

        // 初期ロード時に自動的にプリンタ一覧を取得して設定を反映
        loadPrintersAndApplyConfig(false);

        // プリンタ一覧取得ボタン
        document.getElementById('btn-load').addEventListener('click', async () => {
            await loadPrintersAndApplyConfig(true);
        });

        // プリンタ設定を保存
        document.getElementById('btn-save-printers').addEventListener('click', async () => {
            try {
                const cfg = await window.electronAPI.loadConfig();
                cfg.printer1 = document.getElementById('printer1').value;
                cfg.printer2 = document.getElementById('printer2').value;
                cfg.printer3 = document.getElementById('printer3').value;
                cfg.printer4 = document.getElementById('printer4').value;

                await window.electronAPI.saveConfig(cfg);
                alert('プリンタ設定を保存しました');
            } catch (e) {
                alert('保存に失敗: ' + e.message);
            }
        });

        // 手動印刷（S3からsample.pdfをダウンロードして印刷）
        document.getElementById('btn-print').addEventListener('click', async () => {
            const printerName = document.getElementById('test-printer').value;

            if (!printerName) return alert('プリンタを選択してください');

            try {
                // S3からsample.pdfをダウンロード
                const filePath = await window.electronAPI.downloadSamplePdf();
                // ダウンロードしたファイルを印刷
                await window.electronAPI.printToPrinter(printerName, filePath);
                alert('印刷完了');
            } catch (e) {
                alert('印刷失敗: ' + e.message);
            }
        });

        // ポーリング開始・停止（メニューから操作するため、ボタンは削除済み）
        if (document.getElementById('btn-start')) {
            document.getElementById('btn-start').addEventListener('click', () => {
                window.electronAPI.startPolling();
                alert('ポーリング開始');
            });
        }
        if (document.getElementById('btn-stop')) {
            document.getElementById('btn-stop').addEventListener('click', () => {
                window.electronAPI.stopPolling();
                alert('ポーリング停止');
            });
        }
    }

    // --- 設定タブ用処理 ---
    if (document.getElementById('cfg-pollInterval')) {
        // 初期ロード時に設定を読み込み
        window.electronAPI.loadConfig().then(cfg => {
            document.getElementById('cfg-pollInterval').value = cfg.pollInterval;
            document.getElementById('cfg-apiAddress').value = cfg.apiAddress;
            document.getElementById('cfg-s3-bucket').value = cfg.s3.bucket;
            document.getElementById('cfg-s3-region').value = cfg.s3.region;
            document.getElementById('cfg-s3-accessKeyId').value = cfg.s3.accessKeyId;
            document.getElementById('cfg-s3-secretAccessKey').value = cfg.s3.secretAccessKey;
        }).catch(() => alert('設定読み込み失敗'));

        // 設定を保存
        document.getElementById('btn-save-config').addEventListener('click', async () => {
            const currentCfg = await window.electronAPI.loadConfig();
            const newCfg = {
                pollInterval: Number(document.getElementById('cfg-pollInterval').value),
                apiAddress: document.getElementById('cfg-apiAddress').value,
                syncApiAddress: currentCfg.syncApiAddress || '', // 既存値を保持
                printer1: currentCfg.printer1 || '',
                printer2: currentCfg.printer2 || '',
                printer3: currentCfg.printer3 || '',
                printer4: currentCfg.printer4 || '',
                s3: {
                    bucket: document.getElementById('cfg-s3-bucket').value,
                    region: document.getElementById('cfg-s3-region').value,
                    accessKeyId: document.getElementById('cfg-s3-accessKeyId').value,
                    secretAccessKey: document.getElementById('cfg-s3-secretAccessKey').value,
                },
            };
            window.electronAPI.saveConfig(newCfg)
                .then(() => alert('設定を保存しました'))
                .catch(() => alert('設定保存に失敗しました'));
        });
    }

    // --- 旧設定ウィンドウ用処理（config.html） ---
    if (document.getElementById('cfg-pollInterval') && !document.querySelector('.tabs')) {
        const elems = {
            pollInterval:      document.getElementById('cfg-pollInterval'),
            apiAddress:        document.getElementById('cfg-apiAddress'),
            syncApiAddress:    document.getElementById('cfg-syncApiAddress'),
            printer1:          document.getElementById('cfg-printer1'),
            printer2:          document.getElementById('cfg-printer2'),
            printer3:          document.getElementById('cfg-printer3'),
            printer4:          document.getElementById('cfg-printer4'),
            loadPrintersBtn:   document.getElementById('btn-load-printers'),
            s3: {
                bucket:          document.getElementById('cfg-s3-bucket'),
                region:          document.getElementById('cfg-s3-region'),
                accessKeyId:     document.getElementById('cfg-s3-accessKeyId'),
                secretAccessKey: document.getElementById('cfg-s3-secretAccessKey'),
            },
            saveBtn:           document.getElementById('btn-save-config'),
        };

        // プリンタ一覧読み込み
        elems.loadPrintersBtn.addEventListener('click', async () => {
            try {
                const ps = await window.electronAPI.getPrinters();
                const selects = [elems.printer1, elems.printer2, elems.printer3, elems.printer4];

                selects.forEach(sel => {
                    const currentValue = sel.value;
                    sel.innerHTML = '<option value="">（未設定）</option>';
                    ps.forEach(p => {
                        const o = document.createElement('option');
                        o.value = p.name;
                        o.textContent = p.name + (p.isDefault ? ' (Default)' : '');
                        sel.appendChild(o);
                    });
                    // 前の値を復元
                    if (currentValue) sel.value = currentValue;
                });
                alert('プリンタ一覧を読み込みました');
            } catch {
                alert('プリンタ一覧取得に失敗');
            }
        });

        // 読み込み
        window.electronAPI.loadConfig().then(cfg => {
            elems.pollInterval.value       = cfg.pollInterval;
            elems.apiAddress.value         = cfg.apiAddress;
            elems.syncApiAddress.value     = cfg.syncApiAddress;
            elems.printer1.value           = cfg.printer1 || '';
            elems.printer2.value           = cfg.printer2 || '';
            elems.printer3.value           = cfg.printer3 || '';
            elems.printer4.value           = cfg.printer4 || '';
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
                printer1:       elems.printer1.value,
                printer2:       elems.printer2.value,
                printer3:       elems.printer3.value,
                printer4:       elems.printer4.value,
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
