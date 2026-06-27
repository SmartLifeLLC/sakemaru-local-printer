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

            // プリンタ設定タブが選択された場合、プリンタ一覧を自動読み込み
            if (targetTab === 'printer' && window.loadPrintersAndApplyConfig) {
                window.loadPrintersAndApplyConfig(false);
            }
        });
    });

    // --- 新しいホームタブ用処理 ---
    if (document.getElementById('btn-start-polling')) {
        const pollingStatus = document.getElementById('polling-status');
        const lastPollTime = document.getElementById('last-poll-time');
        const errorLog = document.getElementById('error-log');
        const startBtn = document.getElementById('btn-start-polling');
        const stopBtn = document.getElementById('btn-stop-polling');
        let logLines = [];

        // エラーログに行を追加
        function addLogLine(message, type = 'info') {
            const timestamp = new Date().toLocaleString('ja-JP');
            const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
            logLines.push(`[${timestamp}] ${prefix} ${message}`);
            if (logLines.length > 200) logLines.shift(); // 最大200行まで
            errorLog.textContent = logLines.join('\n');
            errorLog.scrollTop = errorLog.scrollHeight;
        }

        // ポーリング開始
        startBtn.addEventListener('click', async () => {
            try {
                // 設定を読み込んで検証
                const cfg = await window.electronAPI.loadConfig();

                // API接続テスト
                addLogLine('API接続をテスト中...', 'info');
                const testResult = await window.electronAPI.testApiConnection({
                    apiHost: cfg.apiHost,
                    apiToken: cfg.apiToken
                });

                if (!testResult.success) {
                    addLogLine(`API接続テスト失敗: ${testResult.error}`, 'error');
                    const confirmStart = confirm(
                        '⚠️ API接続テストが失敗しました\n\n' +
                        `エラー: ${testResult.error}\n\n` +
                        'このままポーリングを開始しますか？\n' +
                        '(正常に動作しない可能性があります)'
                    );
                    if (!confirmStart) {
                        return;
                    }
                }

                // ポーリング開始
                await window.electronAPI.startPolling();
                pollingStatus.textContent = '動作中';
                pollingStatus.style.color = '#28a745';
                startBtn.style.display = 'none';
                stopBtn.style.display = '';
                addLogLine('ポーリングを開始しました', 'success');
                alert('✅ ポーリングを開始しました');
            } catch (e) {
                addLogLine('ポーリング開始に失敗: ' + e.message, 'error');
                alert('❌ ポーリング開始に失敗: ' + e.message);
            }
        });

        // ポーリング停止
        stopBtn.addEventListener('click', async () => {
            try {
                await window.electronAPI.stopPolling();
                pollingStatus.textContent = '停止中';
                pollingStatus.style.color = '#dc3545';
                stopBtn.style.display = 'none';
                startBtn.style.display = '';
                addLogLine('ポーリングを停止しました', 'info');
                alert('ポーリングを停止しました');
            } catch (e) {
                addLogLine('ポーリング停止に失敗: ' + e.message, 'error');
                alert('ポーリング停止に失敗: ' + e.message);
            }
        });

        // main processからのステータス更新を受信
        window.electronAPI.onPollStatus((data) => {
            // ログメッセージの場合はタイムスタンプ不要（すでに含まれている）
            if (data.status === 'log') {
                addLogLine(data.message, data.type);
                lastPollTime.textContent = new Date().toLocaleString('ja-JP');

                // 自動起動時のUI状態更新
                if (data.message.includes('ポーリングを開始しました')) {
                    pollingStatus.textContent = '動作中';
                    pollingStatus.style.color = '#28a745';
                    startBtn.style.display = 'none';
                    stopBtn.style.display = '';
                }
            } else if (data.status === 'received') {
                lastPollTime.textContent = new Date().toLocaleString('ja-JP');
                addLogLine('タスクを受信しました', 'info');
            } else if (data.status === 'downloading') {
                lastPollTime.textContent = new Date().toLocaleString('ja-JP');
                addLogLine(`${data.count}個のファイルをダウンロード中...`, 'info');
            } else if (data.status === 'printed') {
                lastPollTime.textContent = new Date().toLocaleString('ja-JP');
                const msg = data.order !== undefined
                    ? `印刷完了: order=${data.order}, file_id=${data.file_id}, printer=${data.printer}`
                    : `印刷完了: printer=${data.printer || 'unknown'}`;
                addLogLine(msg, 'success');
            } else if (data.status === 'error') {
                lastPollTime.textContent = new Date().toLocaleString('ja-JP');
                const errorMsg = data.message || data.error || '不明なエラーが発生しました';
                addLogLine('エラー: ' + errorMsg, 'error');
            }
        });

        // バージョン情報を取得して表示
        window.electronAPI.getAppVersion().then(version => {
            const versionElement = document.getElementById('app-version');
            if (versionElement) {
                versionElement.textContent = `v${version}`;
            }
        }).catch(err => {
            console.error('Failed to get app version:', err);
        });

        // 初期ログメッセージ
        addLogLine('アプリケーション起動', 'info');
    }

    // --- プリンタ設定タブ用処理 ---
    if (document.getElementById('btn-load')) {
        const MAX_PRINTERS = 10;
        let availablePrinters = []; // システムから取得したプリンタ一覧

        // プリンタスロットを動的に生成
        function createPrinterSlots() {
            const grid = document.getElementById('printer-grid');
            if (!grid) return;

            grid.innerHTML = '';
            for (let i = 0; i < MAX_PRINTERS; i++) {
                const slot = document.createElement('div');
                slot.className = 'printer-slot';
                slot.innerHTML = `
                    <span class="printer-number">${i}</span>
                    <select id="printer${i}">
                        <option value="">（未設定）</option>
                    </select>
                    <button type="button" class="printer-settings-btn" data-printer-slot="${i}" title="印刷設定" disabled>⚙️</button>
                `;
                grid.appendChild(slot);
            }

            // 各selectに変更イベントを追加して重複チェック+設定ボタン状態更新
            for (let i = 0; i < MAX_PRINTERS; i++) {
                const select = document.getElementById(`printer${i}`);
                if (select) {
                    select.addEventListener('change', () => {
                        checkDuplicatePrinters();
                        updateSettingsButtonState(i);
                    });
                }
            }

            // 設定ボタンクリック
            grid.querySelectorAll('.printer-settings-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const slotIndex = Number(btn.getAttribute('data-printer-slot'));
                    const printerName = document.getElementById(`printer${slotIndex}`).value;
                    if (printerName) openPrinterSettingsModal(slotIndex, printerName);
                });
            });
        }

        // 設定ボタンの有効/無効、「カスタム済」表示、設定名表示を更新
        // v1.3: 設定はプリンタスロット index ベース
        function updateSettingsButtonState(slotIndex) {
            const select = document.getElementById(`printer${slotIndex}`);
            const btn = document.querySelector(`.printer-settings-btn[data-printer-slot="${slotIndex}"]`);
            if (!select || !btn) return;
            const printerName = select.value;
            if (!printerName) {
                btn.disabled = true;
                btn.classList.remove('has-custom');
                btn.textContent = '⚙️';
                btn.title = '印刷設定';
                return;
            }
            btn.disabled = false;
            window.electronAPI.loadConfig().then(cfg => {
                const ps = (cfg.printerSettings || {})[String(slotIndex)];
                const hasCustom = ps && (
                    (ps.orientation && ps.orientation !== 'auto') ||
                    (ps.paperSize && ps.paperSize !== 'auto') ||
                    (Number(ps.offsetX) || 0) !== 0 ||
                    (Number(ps.offsetY) || 0) !== 0
                );
                if (hasCustom) btn.classList.add('has-custom');
                else btn.classList.remove('has-custom');

                // 設定名があればボタンに表示、なければアイコンのみ
                const name = ps && ps.settingName ? String(ps.settingName).trim() : '';
                if (name) {
                    btn.textContent = `⚙️ ${name}`;
                    btn.title = `${name}（クリックで編集）`;
                } else {
                    btn.textContent = '⚙️';
                    btn.title = hasCustom ? '印刷設定（カスタム済）' : '印刷設定';
                }
            }).catch(() => {});
        }

        // モーダル開閉（スロット index ベース）
        let currentModalSlot = null;
        let currentModalPrinterName = null;
        async function openPrinterSettingsModal(slotIndex, printerName) {
            currentModalSlot = slotIndex;
            currentModalPrinterName = printerName;
            const cfg = await window.electronAPI.loadConfig();
            const ps = (cfg.printerSettings || {})[String(slotIndex)] || {};

            document.getElementById('modal-printer-name').textContent = `スロット ${slotIndex}: ${printerName}`;
            document.getElementById('modal-settingName').value = ps.settingName || '';
            document.getElementById('modal-orientation').value = ps.orientation || 'auto';
            document.getElementById('modal-paperSize').value = ps.paperSize || 'auto';
            document.getElementById('modal-offsetX').value = Number(ps.offsetX) || 0;
            document.getElementById('modal-offsetY').value = Number(ps.offsetY) || 0;

            // テスト結果表示をクリア
            const testResult = document.getElementById('modal-test-result');
            if (testResult) { testResult.style.display = 'none'; testResult.innerHTML = ''; }

            document.getElementById('printer-settings-modal').classList.add('active');
        }

        function closePrinterSettingsModal() {
            document.getElementById('printer-settings-modal').classList.remove('active');
            currentModalSlot = null;
            currentModalPrinterName = null;
        }

        // モーダル: キャンセル
        document.getElementById('modal-cancel').addEventListener('click', closePrinterSettingsModal);
        // モーダル: 背景クリックで閉じる
        document.getElementById('printer-settings-modal').addEventListener('click', (e) => {
            if (e.target.id === 'printer-settings-modal') closePrinterSettingsModal();
        });
        // モーダル: テスト印刷（現在モーダルに入力中の設定値で印刷、保存はしない）
        document.getElementById('modal-test-print').addEventListener('click', async () => {
            if (currentModalSlot === null || !currentModalPrinterName) return;
            const resultDiv = document.getElementById('modal-test-result');
            const btn = document.getElementById('modal-test-print');

            // PDFファイル選択
            let filePath;
            try {
                filePath = await window.electronAPI.pickPdfFile();
            } catch (e) {
                resultDiv.style.display = 'block';
                resultDiv.style.backgroundColor = '#ffebee';
                resultDiv.style.border = '1px solid #f44336';
                resultDiv.innerHTML = `❌ ファイル選択エラー: ${e.message}`;
                return;
            }
            if (!filePath) return; // キャンセル

            // 現在モーダルに入力中の設定値を取得
            const settings = {
                orientation: document.getElementById('modal-orientation').value,
                paperSize: document.getElementById('modal-paperSize').value,
                offsetX: Number(document.getElementById('modal-offsetX').value) || 0,
                offsetY: Number(document.getElementById('modal-offsetY').value) || 0,
            };

            // 印刷中表示
            resultDiv.style.display = 'block';
            resultDiv.style.backgroundColor = '#e3f2fd';
            resultDiv.style.border = '1px solid #2196f3';
            resultDiv.innerHTML = `⏳ 印刷中: ${filePath.split(/[\\/]/).pop()}`;
            btn.disabled = true;

            try {
                await window.electronAPI.testPrintWithSettings(
                    currentModalPrinterName,
                    filePath,
                    settings
                );
                resultDiv.style.backgroundColor = '#e8f5e9';
                resultDiv.style.border = '1px solid #4caf50';
                resultDiv.innerHTML = `✅ テスト印刷を送信しました（${currentModalPrinterName}）`;
            } catch (e) {
                resultDiv.style.backgroundColor = '#ffebee';
                resultDiv.style.border = '1px solid #f44336';
                resultDiv.innerHTML = `❌ 印刷失敗: ${e.message}`;
            } finally {
                btn.disabled = false;
            }
        });
        // モーダル: リセット（設定削除）
        document.getElementById('modal-reset').addEventListener('click', async () => {
            if (currentModalSlot === null) return;
            const key = String(currentModalSlot);
            if (!confirm(`スロット ${currentModalSlot} の印刷設定をリセットしますか？`)) return;
            const cfg = await window.electronAPI.loadConfig();
            const printerSettings = cfg.printerSettings || {};
            delete printerSettings[key];
            cfg.printerSettings = printerSettings;
            await window.electronAPI.saveConfig(cfg);
            closePrinterSettingsModal();
            for (let i = 0; i < MAX_PRINTERS; i++) updateSettingsButtonState(i);
        });
        // モーダル: 保存
        document.getElementById('modal-save').addEventListener('click', async () => {
            if (currentModalSlot === null) return;
            const key = String(currentModalSlot);
            const settingName = document.getElementById('modal-settingName').value.trim();
            const orientation = document.getElementById('modal-orientation').value;
            const paperSize = document.getElementById('modal-paperSize').value;
            const offsetX = Number(document.getElementById('modal-offsetX').value) || 0;
            const offsetY = Number(document.getElementById('modal-offsetY').value) || 0;

            const cfg = await window.electronAPI.loadConfig();
            const printerSettings = cfg.printerSettings || {};

            // 設定値がすべてデフォルトかつ設定名も空なら削除（＝未設定状態）
            const isDefault = !settingName
                && orientation === 'auto'
                && paperSize === 'auto'
                && offsetX === 0
                && offsetY === 0;
            if (isDefault) {
                delete printerSettings[key];
            } else {
                printerSettings[key] = { settingName, orientation, paperSize, offsetX, offsetY };
            }
            cfg.printerSettings = printerSettings;
            await window.electronAPI.saveConfig(cfg);
            closePrinterSettingsModal();
            for (let i = 0; i < MAX_PRINTERS; i++) updateSettingsButtonState(i);
        });

        // 同一プリンタが複数スロットに割当てられているかチェック（情報表示のみ、保存はブロックしない）
        // 同名プリンタでもスロットごとに別設定で印刷できるため、重複は許可する仕様。
        function checkDuplicatePrinters() {
            const selectedPrinters = [];
            const duplicates = new Set();

            for (let i = 0; i < MAX_PRINTERS; i++) {
                const select = document.getElementById(`printer${i}`);
                if (select && select.value) {
                    if (selectedPrinters.includes(select.value)) {
                        duplicates.add(select.value);
                    } else {
                        selectedPrinters.push(select.value);
                    }
                }
            }

            // 情報表示（重複してもボーダーは変えず、案内文だけ出す）
            const warning = document.getElementById('printer-duplicate-warning');
            if (warning) {
                warning.style.display = duplicates.size > 0 ? 'block' : 'none';
            }

            // ボーダーはニュートラルに固定
            for (let i = 0; i < MAX_PRINTERS; i++) {
                const select = document.getElementById(`printer${i}`);
                if (select) select.style.borderColor = '#ddd';
            }

            return true; // 常に保存可能
        }

        // プリンタ一覧を読み込んで設定を反映する関数
        async function loadPrintersAndApplyConfig(showAlert = false) {
            try {
                // プリンタスロットを動的に生成
                createPrinterSlots();

                // 保存済みの設定を取得
                const cfg = await window.electronAPI.loadConfig();

                // プリンタ一覧を取得
                console.log('Calling getPrinters...');
                const ps = await window.electronAPI.getPrinters();
                console.log('Got printers:', ps);
                availablePrinters = ps;

                const printerNames = ps.map(p => p.name);

                // プリンタスロット用のselectを更新
                for (let i = 0; i < MAX_PRINTERS; i++) {
                    const sel = document.getElementById(`printer${i}`);
                    if (!sel) continue;

                    sel.innerHTML = '<option value="">（未設定）</option>';

                    // システムから取得したプリンタをオプションに追加
                    ps.forEach(p => {
                        const o = document.createElement('option');
                        o.value = p.name;
                        o.textContent = p.name + (p.isDefault ? ' (Default)' : '');
                        sel.appendChild(o);
                    });

                    const savedValue = cfg[`printer${i}`] || '';

                    // 保存済みの設定がシステムに存在しない場合、オプションとして追加（警告付き）
                    if (savedValue && !printerNames.includes(savedValue)) {
                        const o = document.createElement('option');
                        o.value = savedValue;
                        o.textContent = `${savedValue} ⚠️ (システムに見つかりません)`;
                        o.style.color = '#d32f2f';
                        sel.appendChild(o);
                        console.warn(`Saved printer "${savedValue}" not found in system`);
                    }

                    // 保存済みの設定を反映
                    if (savedValue) {
                        sel.value = savedValue;
                        console.log(`Set printer${i} to: ${savedValue}`);
                    }
                }

                // テスト印刷用のselectも更新
                const testPrinterSelect = document.getElementById('test-printer');
                if (testPrinterSelect) {
                    testPrinterSelect.innerHTML = '<option value="">（プリンタを選択）</option>';
                    ps.forEach(p => {
                        const o = document.createElement('option');
                        o.value = p.name;
                        o.textContent = p.name + (p.isDefault ? ' (Default)' : '');
                        testPrinterSelect.appendChild(o);
                    });
                }

                // 重複チェック
                checkDuplicatePrinters();

                // 設定ボタンの状態を反映
                for (let i = 0; i < MAX_PRINTERS; i++) updateSettingsButtonState(i);

                if (showAlert) {
                    alert(`プリンタ一覧を読み込みました（${ps.length}台）`);
                }
            } catch (err) {
                console.error('プリンタ一覧取得エラー:', err);
                if (showAlert) {
                    alert('プリンタ一覧取得に失敗: ' + err.message);
                }
            }
        }

        // グローバルスコープに関数を公開（タブ切り替え時に使用）
        window.loadPrintersAndApplyConfig = loadPrintersAndApplyConfig;

        // 初期ロード時に自動的にプリンタ一覧を取得して設定を反映
        loadPrintersAndApplyConfig(false);

        // プリンタ一覧取得ボタン
        document.getElementById('btn-load').addEventListener('click', async () => {
            await loadPrintersAndApplyConfig(true);
        });

        // プリンタ設定を保存 & サーバーに同期
        document.getElementById('btn-save-printers').addEventListener('click', async () => {
            // 重複は警告のみで保存ブロックしない
            checkDuplicatePrinters();

            try {
                const cfg = await window.electronAPI.loadConfig();

                // 10個のプリンタ設定を保存
                for (let i = 0; i < MAX_PRINTERS; i++) {
                    const select = document.getElementById(`printer${i}`);
                    cfg[`printer${i}`] = select ? select.value : '';
                }

                // ローカルに保存
                await window.electronAPI.saveConfig(cfg);

                // 倉庫IDが設定されている場合、サーバーに同期
                // v1.3: スロット index ベースで全スロットを送信（同名プリンタの重複除去は行わない）
                if (cfg.warehouseId && String(cfg.warehouseId).trim() !== '') {
                    const printers = [];
                    for (let i = 0; i < MAX_PRINTERS; i++) {
                        const printerName = cfg[`printer${i}`];
                        if (printerName) {
                            printers.push({
                                printer_index: i,
                                name: printerName,
                                is_default: printers.length === 0 // 最初に登場したスロットをデフォルト
                            });
                        }
                    }

                    if (printers.length > 0) {
                        const syncResult = await window.electronAPI.syncPrinters(cfg.warehouseId, printers);
                        if (syncResult.success) {
                            alert(`プリンタ設定を保存し、サーバーに同期しました（${printers.length}台）`);
                        } else {
                            alert(`プリンタ設定を保存しました\n\n⚠️ サーバー同期失敗: ${syncResult.error || '不明なエラー'}`);
                        }
                    } else {
                        alert('プリンタ設定を保存しました（プリンタ未設定のため同期スキップ）');
                    }
                } else {
                    alert('プリンタ設定を保存しました\n\n※ 倉庫が設定されていないため、サーバー同期はスキップされました');
                }
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

    // --- 設定タブ用処理（index.html内のタブ） ---
    if (document.getElementById('cfg-pollInterval') && document.querySelector('.tabs')) {
        // 初期ロード時に設定を読み込み
        window.electronAPI.loadConfig().then(async cfg => {
            document.getElementById('cfg-pollInterval').value = cfg.pollInterval;
            document.getElementById('cfg-apiHost').value = cfg.apiHost;
            document.getElementById('cfg-apiToken').value = cfg.apiToken || '';
            document.getElementById('cfg-clientId').value = cfg.clientId || '';
            document.getElementById('cfg-warehouseId').value = cfg.warehouseId || '';
            document.getElementById('cfg-s3-bucket').value = cfg.s3.bucket;
            document.getElementById('cfg-s3-region').value = cfg.s3.region;
            document.getElementById('cfg-s3-accessKeyId').value = cfg.s3.accessKeyId;
            document.getElementById('cfg-s3-secretAccessKey').value = cfg.s3.secretAccessKey;
            document.getElementById('cfg-printMethod').value = cfg.printMethod || 'pdf-to-printer';
            document.getElementById('cfg-sumatraPdfPath').value = cfg.sumatraPdfPath || 'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe';

            // 現在の倉庫設定を表示
            const warehouseDisplay = document.getElementById('current-warehouse-display');
            if (cfg.warehouseId && String(cfg.warehouseId).trim() !== '') {
                warehouseDisplay.textContent = `ID: ${cfg.warehouseId}`;
                warehouseDisplay.style.color = '#667eea';

                // 倉庫一覧を取得して倉庫名を表示
                if (cfg.apiHost && cfg.apiHost.trim() !== '') {
                    try {
                        const response = await fetch(`https://${cfg.apiHost}/api/printer/warehouses`, {
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${cfg.apiToken || ''}`
                            }
                        });

                        if (response.ok) {
                            const result = await response.json();
                            const warehouses = result.success && result.data ? result.data : [];
                            const warehouse = warehouses.find(w => w.id == cfg.warehouseId);

                            if (warehouse) {
                                warehouseDisplay.textContent = `${warehouse.name} (ID: ${cfg.warehouseId})`;
                            }
                        }
                    } catch (err) {
                        console.log('倉庫情報取得失敗:', err.message);
                    }
                }
            } else {
                warehouseDisplay.textContent = 'クライアントIDで識別';
                warehouseDisplay.style.color = '#999';
            }
        }).catch(() => alert('設定読み込み失敗'));

        // 倉庫セレクトボックスの変更イベント
        document.getElementById('cfg-warehouseId').addEventListener('change', (e) => {
            const warehouseDisplay = document.getElementById('current-warehouse-display');
            const selectedOption = e.target.selectedOptions[0];

            if (e.target.value === '') {
                // クライアントIDで識別
                warehouseDisplay.textContent = 'クライアントIDで識別';
                warehouseDisplay.style.color = '#999';
            } else {
                // 特定の倉庫を選択した場合
                warehouseDisplay.textContent = selectedOption.textContent;
                warehouseDisplay.style.color = '#667eea';
            }
        });

        // 倉庫一覧読み込み
        document.getElementById('btn-load-warehouses').addEventListener('click', async () => {
            const apiHost = document.getElementById('cfg-apiHost').value;
            const apiToken = document.getElementById('cfg-apiToken').value;

            if (!apiHost || apiHost.trim() === '') {
                alert('APIホストを入力してください');
                return;
            }

            try {
                const response = await fetch(`https://${apiHost}/api/printer/warehouses`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiToken}`
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const result = await response.json();
                const warehouses = result.success && result.data ? result.data : [];

                const warehouseSelect = document.getElementById('cfg-warehouseId');
                const currentValue = warehouseSelect.value;
                warehouseSelect.innerHTML = '<option value="">（クライアントID で識別）</option>';

                warehouses.forEach(w => {
                    const o = document.createElement('option');
                    o.value = w.id;
                    o.textContent = `${w.name} (ID: ${w.id})`;
                    warehouseSelect.appendChild(o);
                });

                // 前の値を復元
                if (currentValue) {
                    warehouseSelect.value = currentValue;
                    // 現在の倉庫設定表示も更新
                    const selectedWarehouse = warehouses.find(w => w.id == currentValue);
                    const warehouseDisplay = document.getElementById('current-warehouse-display');
                    if (selectedWarehouse) {
                        warehouseDisplay.textContent = `${selectedWarehouse.name} (ID: ${currentValue})`;
                        warehouseDisplay.style.color = '#667eea';
                    }
                }

                alert(`${warehouses.length}件の倉庫を読み込みました`);
            } catch (err) {
                alert('倉庫一覧取得に失敗: ' + err.message);
            }
        });

        // API接続テスト
        document.getElementById('btn-test-api').addEventListener('click', async () => {
            const apiHost = document.getElementById('cfg-apiHost').value;
            const apiToken = document.getElementById('cfg-apiToken').value;
            const resultDiv = document.getElementById('api-test-result');

            if (!apiHost || apiHost.trim() === '') {
                resultDiv.style.display = 'block';
                resultDiv.style.backgroundColor = '#ffebee';
                resultDiv.style.border = '1px solid #f44336';
                resultDiv.innerHTML = '❌ APIホストを入力してください';
                return;
            }

            // テスト中の表示
            resultDiv.style.display = 'block';
            resultDiv.style.backgroundColor = '#e3f2fd';
            resultDiv.style.border = '1px solid #2196f3';
            resultDiv.innerHTML = '⏳ API接続をテスト中...';

            try {
                const result = await window.electronAPI.testApiConnection({
                    apiHost: apiHost,
                    apiToken: apiToken
                });

                if (result.success) {
                    resultDiv.style.backgroundColor = '#e8f5e9';
                    resultDiv.style.border = '1px solid #4caf50';
                    let successHtml = `✅ ${result.message}`;
                    if (result.serverVersion || result.clientId || result.timestamp) {
                        successHtml += '<br><small>';
                        if (result.serverVersion) successHtml += `Server: ${result.serverVersion}`;
                        if (result.clientId) successHtml += ` | Client ID: ${result.clientId}`;
                        if (result.timestamp) successHtml += `<br>Time: ${result.timestamp}`;
                        successHtml += '</small>';
                    }
                    resultDiv.innerHTML = successHtml;
                } else {
                    resultDiv.style.backgroundColor = '#ffebee';
                    resultDiv.style.border = '1px solid #f44336';
                    let errorHtml = `❌ ${result.error}`;
                    if (result.status) {
                        errorHtml += `<br><small>HTTP Status: ${result.status} ${result.statusText || ''}</small>`;
                    }
                    resultDiv.innerHTML = errorHtml;
                }
            } catch (err) {
                resultDiv.style.backgroundColor = '#ffebee';
                resultDiv.style.border = '1px solid #f44336';
                resultDiv.innerHTML = `❌ テスト中にエラーが発生: ${err.message}`;
            }
        });

        // 設定を保存
        document.getElementById('btn-save-config').addEventListener('click', async () => {
            const currentCfg = await window.electronAPI.loadConfig();
            const newCfg = {
                pollInterval: Number(document.getElementById('cfg-pollInterval').value),
                apiHost: document.getElementById('cfg-apiHost').value,
                apiToken: document.getElementById('cfg-apiToken').value,
                warehouseId: document.getElementById('cfg-warehouseId').value,
                printer0: currentCfg.printer0 || '',
                printer1: currentCfg.printer1 || '',
                printer2: currentCfg.printer2 || '',
                printer3: currentCfg.printer3 || '',
                printer4: currentCfg.printer4 || '',
                printer5: currentCfg.printer5 || '',
                printer6: currentCfg.printer6 || '',
                printer7: currentCfg.printer7 || '',
                printer8: currentCfg.printer8 || '',
                printer9: currentCfg.printer9 || '',
                printMethod: document.getElementById('cfg-printMethod').value,
                sumatraPdfPath: document.getElementById('cfg-sumatraPdfPath').value,
                printerSettings: currentCfg.printerSettings || {},
                s3: {
                    bucket: document.getElementById('cfg-s3-bucket').value,
                    region: document.getElementById('cfg-s3-region').value,
                    accessKeyId: document.getElementById('cfg-s3-accessKeyId').value,
                    secretAccessKey: document.getElementById('cfg-s3-secretAccessKey').value,
                },
            };

            // バリデーション
            if (!newCfg.apiHost || newCfg.apiHost.trim() === '') {
                alert('エラー: APIホストを入力してください');
                return;
            }

            // API接続テストを実行
            const testResult = await window.electronAPI.testApiConnection({
                apiHost: newCfg.apiHost,
                apiToken: newCfg.apiToken
            });

            if (!testResult.success) {
                const confirmSave = confirm(
                    `⚠️ API接続テストが失敗しました\n\n` +
                    `エラー: ${testResult.error}\n\n` +
                    `このまま保存しますか？\n` +
                    `(ポーリングは自動で開始されません。手動で開始してください)`
                );
                if (!confirmSave) {
                    return;
                }
            }

            // 設定変更の確認
            if (confirm('設定を保存しますか？\n\nポーリングが実行中の場合は停止されます。\n保存後、必要に応じて手動でポーリングを開始してください。')) {
                window.electronAPI.saveConfig(newCfg)
                    .then(() => {
                        alert('設定を保存しました。\n\nポーリングを開始する場合は、「🍶 酒まる印刷」タブから開始ボタンをクリックしてください。');
                    })
                    .catch(() => alert('設定保存に失敗しました'));
            }
        });
    }

    // --- 旧設定ウィンドウ用処理（config.html） ---
    if (document.getElementById('cfg-pollInterval') && !document.querySelector('.tabs')) {
        const elems = {
            pollInterval:       document.getElementById('cfg-pollInterval'),
            apiHost:            document.getElementById('cfg-apiHost'),
            apiToken:           document.getElementById('cfg-apiToken'),
            warehouseId:        document.getElementById('cfg-warehouseId'),
            loadWarehousesBtn:  document.getElementById('btn-load-warehouses'),
            printer0:           document.getElementById('cfg-printer0'),
            printer1:           document.getElementById('cfg-printer1'),
            printer2:           document.getElementById('cfg-printer2'),
            printer3:           document.getElementById('cfg-printer3'),
            loadPrintersBtn:    document.getElementById('btn-load-printers'),
            testApiBtn:         document.getElementById('btn-test-api'),
            apiTestResult:      document.getElementById('api-test-result'),
            s3: {
                bucket:          document.getElementById('cfg-s3-bucket'),
                region:          document.getElementById('cfg-s3-region'),
                accessKeyId:     document.getElementById('cfg-s3-accessKeyId'),
                secretAccessKey: document.getElementById('cfg-s3-secretAccessKey'),
            },
            saveBtn:            document.getElementById('btn-save-config'),
        };

        // 倉庫一覧読み込み
        elems.loadWarehousesBtn.addEventListener('click', async () => {
            const apiHost = elems.apiHost.value;
            const apiToken = elems.apiToken.value;

            if (!apiHost || apiHost.trim() === '') {
                alert('APIホストを入力してください');
                return;
            }

            try {
                const response = await fetch(`https://${apiHost}/api/printer/warehouses`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiToken}`
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const result = await response.json();
                const warehouses = result.success && result.data ? result.data : [];

                const currentValue = elems.warehouseId.value;
                elems.warehouseId.innerHTML = '<option value="">（クライアントID で識別）</option>';

                warehouses.forEach(w => {
                    const o = document.createElement('option');
                    o.value = w.id;
                    o.textContent = `${w.name} (ID: ${w.id})`;
                    elems.warehouseId.appendChild(o);
                });

                // 前の値を復元
                if (currentValue) {
                    elems.warehouseId.value = currentValue;
                }

                alert(`${warehouses.length}件の倉庫を読み込みました`);
            } catch (err) {
                alert('倉庫一覧取得に失敗: ' + err.message);
            }
        });

        // プリンタ一覧読み込み
        elems.loadPrintersBtn.addEventListener('click', async () => {
            try {
                const ps = await window.electronAPI.getPrinters();
                const selects = [elems.printer0, elems.printer1, elems.printer2, elems.printer3];
                const printerNames = ps.map(p => p.name);

                selects.forEach((sel, index) => {
                    const currentValue = sel.value;
                    console.log(`Reloading printer${index}, current value: ${currentValue}`);

                    sel.innerHTML = '<option value="">（未設定）</option>';

                    // システムから取得したプリンタをオプションに追加
                    ps.forEach(p => {
                        const o = document.createElement('option');
                        o.value = p.name;
                        o.textContent = p.name + (p.isDefault ? ' (Default)' : '');
                        sel.appendChild(o);
                    });

                    // 現在の値がシステムに存在しない場合、オプションとして追加（警告付き）
                    if (currentValue && !printerNames.includes(currentValue)) {
                        const o = document.createElement('option');
                        o.value = currentValue;
                        o.textContent = `${currentValue} ⚠️ (システムに見つかりません)`;
                        o.style.color = '#d32f2f';
                        sel.appendChild(o);
                    }

                    // 前の値を復元
                    if (currentValue) {
                        sel.value = currentValue;
                        console.log(`Restored printer${index} to: ${currentValue}`);
                    }
                });
                alert('プリンタ一覧を読み込みました');
            } catch {
                alert('プリンタ一覧取得に失敗');
            }
        });

        // API接続テスト
        elems.testApiBtn.addEventListener('click', async () => {
            const apiHost = elems.apiHost.value;
            const apiToken = elems.apiToken.value;
            const resultDiv = elems.apiTestResult;

            if (!apiHost || apiHost.trim() === '') {
                resultDiv.style.display = 'block';
                resultDiv.style.backgroundColor = '#ffebee';
                resultDiv.style.border = '1px solid #f44336';
                resultDiv.innerHTML = '❌ APIホストを入力してください';
                return;
            }

            // テスト中の表示
            resultDiv.style.display = 'block';
            resultDiv.style.backgroundColor = '#e3f2fd';
            resultDiv.style.border = '1px solid #2196f3';
            resultDiv.innerHTML = '⏳ API接続をテスト中...';

            try {
                const result = await window.electronAPI.testApiConnection({
                    apiHost: apiHost,
                    apiToken: apiToken
                });

                if (result.success) {
                    resultDiv.style.backgroundColor = '#e8f5e9';
                    resultDiv.style.border = '1px solid #4caf50';
                    let successHtml = `✅ ${result.message}`;
                    if (result.serverVersion || result.clientId || result.timestamp) {
                        successHtml += '<br><small>';
                        if (result.serverVersion) successHtml += `Server: ${result.serverVersion}`;
                        if (result.clientId) successHtml += ` | Client ID: ${result.clientId}`;
                        if (result.timestamp) successHtml += `<br>Time: ${result.timestamp}`;
                        successHtml += '</small>';
                    }
                    resultDiv.innerHTML = successHtml;
                } else {
                    resultDiv.style.backgroundColor = '#ffebee';
                    resultDiv.style.border = '1px solid #f44336';
                    let errorHtml = `❌ ${result.error}`;
                    if (result.status) {
                        errorHtml += `<br><small>HTTP Status: ${result.status} ${result.statusText || ''}</small>`;
                    }
                    resultDiv.innerHTML = errorHtml;
                }
            } catch (err) {
                resultDiv.style.backgroundColor = '#ffebee';
                resultDiv.style.border = '1px solid #f44336';
                resultDiv.innerHTML = `❌ テスト中にエラーが発生: ${err.message}`;
            }
        });

        // 読み込み（プリンタ一覧も自動取得）
        window.electronAPI.loadConfig().then(async cfg => {
            elems.pollInterval.value       = cfg.pollInterval;
            elems.apiHost.value            = cfg.apiHost;
            elems.apiToken.value           = cfg.apiToken || '';
            elems.warehouseId.value        = cfg.warehouseId || '';
            elems.s3.bucket.value          = cfg.s3.bucket;
            elems.s3.region.value          = cfg.s3.region;
            elems.s3.accessKeyId.value     = cfg.s3.accessKeyId;
            elems.s3.secretAccessKey.value = cfg.s3.secretAccessKey;

            // プリンタ一覧を取得して、保存済み設定を反映
            try {
                const ps = await window.electronAPI.getPrinters();
                const selects = [elems.printer0, elems.printer1, elems.printer2, elems.printer3];
                const savedPrinters = [cfg.printer0 || '', cfg.printer1 || '', cfg.printer2 || '', cfg.printer3 || ''];
                const printerNames = ps.map(p => p.name);

                console.log('Loading printers for config.html:', savedPrinters);

                selects.forEach((sel, index) => {
                    sel.innerHTML = '<option value="">（未設定）</option>';

                    // システムから取得したプリンタをオプションに追加
                    ps.forEach(p => {
                        const o = document.createElement('option');
                        o.value = p.name;
                        o.textContent = p.name + (p.isDefault ? ' (Default)' : '');
                        sel.appendChild(o);
                    });

                    // 保存済みの値がシステムに存在しない場合、オプションとして追加（警告付き）
                    if (savedPrinters[index] && !printerNames.includes(savedPrinters[index])) {
                        const o = document.createElement('option');
                        o.value = savedPrinters[index];
                        o.textContent = `${savedPrinters[index]} ⚠️ (システムに見つかりません)`;
                        o.style.color = '#d32f2f';
                        sel.appendChild(o);
                    }

                    // 保存済みの値を設定
                    if (savedPrinters[index]) {
                        sel.value = savedPrinters[index];
                        console.log(`Set config printer${index} to: ${savedPrinters[index]}`);
                    }
                });
            } catch (err) {
                console.error('初期プリンタ読み込みエラー:', err);
            }
        }).catch(() => alert('設定読み込み失敗'));

        // 保存
        elems.saveBtn.addEventListener('click', async () => {
            const newCfg = {
                pollInterval:   Number(elems.pollInterval.value),
                apiHost:        elems.apiHost.value,
                apiToken:       elems.apiToken.value,
                warehouseId:    elems.warehouseId.value,
                printer0:       elems.printer0.value,
                printer1:       elems.printer1.value,
                printer2:       elems.printer2.value,
                printer3:       elems.printer3.value,
                s3: {
                    bucket:          elems.s3.bucket.value,
                    region:          elems.s3.region.value,
                    accessKeyId:     elems.s3.accessKeyId.value,
                    secretAccessKey: elems.s3.secretAccessKey.value,
                },
            };

            // バリデーション
            if (!newCfg.apiHost || newCfg.apiHost.trim() === '') {
                alert('エラー: APIホストを入力してください');
                return;
            }

            // API接続テストを実行
            const testResult = await window.electronAPI.testApiConnection({
                apiHost: newCfg.apiHost,
                apiToken: newCfg.apiToken
            });

            if (!testResult.success) {
                const confirmSave = confirm(
                    `⚠️ API接続テストが失敗しました\n\n` +
                    `エラー: ${testResult.error}\n\n` +
                    `このまま保存しますか？\n` +
                    `(ポーリングは自動で開始されません。手動で開始してください)`
                );
                if (!confirmSave) {
                    return;
                }
            }

            // 設定変更の確認
            if (confirm('設定を保存しますか？\n\nポーリングが実行中の場合は停止されます。\n保存後、必要に応じて手動でポーリングを開始してください。')) {
                window.electronAPI.saveConfig(newCfg)
                    .then(() => {
                        alert('設定を保存しました。\n\nポーリングを開始する場合は、「🍶 酒まる印刷」タブから開始ボタンをクリックしてください。');
                    })
                    .catch(() => alert('設定保存に失敗しました'));
            }
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
