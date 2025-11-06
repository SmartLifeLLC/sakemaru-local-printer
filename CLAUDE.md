# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sakemaru Local Printer (formerly BZCorePrinter) is an Electron-based desktop application that acts as a local print agent for the Sakemaru system. It runs as a **background system tray application** that polls a remote API for print jobs, downloads PDF files from S3, and prints them to configured local printers. The app supports Windows (using `pdf-to-printer`), macOS, and Linux (using `lp` command). Features include:
- Background operation via system tray (continues running when windows are closed)
- Batch printing with parallel downloads
- Multi-printer support (up to 4 printers)
- Bearer token authentication
- File-based daily logging
- Windows auto-start on system boot
- Auto-polling on startup

## Development Commands

### Running the Application
```bash
npm start                 # Launch Electron app in development mode
```

### Building
```bash
npm run build            # Build distributable using electron-builder
                         # Output:
                         #   - dist/win-unpacked/ (Windows portable)
                         #   - dist/酒まる印刷 Setup 1.0.0.exe (Windows installer)
                         #   - dist/mac-arm64/ (macOS)
```

### Installation
Windows: Run `dist/酒まる印刷 Setup 1.0.0.exe` to install. The app will automatically:
- Install to Program Files
- Create desktop shortcut
- Register for Windows auto-start (launches on system boot)

### Installing Dependencies
```bash
npm install              # Install all dependencies
```

## Architecture

### Core Files and Responsibilities

**main.js** - Main process entry point
- Manages Electron windows: main (index.html with tabs) and config (config.html)
- Implements polling mechanism via `pollTask()` that runs at intervals defined in config.json
- Handles S3 file downloads using AWS SDK v3 with parallel download support (max 4 concurrent)
- Cross-platform printing: `pdf-to-printer` for Windows, `lp` command for macOS/Linux
- File-based logging system: daily log files stored in app userData directory
- IPC handlers for renderer communication
- Menu bar with app navigation and context menu (copy/paste) support
- Bearer token authentication support for API requests

**preload.js** - Security bridge between main and renderer processes
- Exposes controlled API via `contextBridge` to renderer
- Prevents direct access to Node.js APIs from renderer for security

**renderer.js** - UI logic for all windows
- Detects which window is loaded by checking for specific DOM elements
- Tab navigation system for multi-tab interfaces
- Home tab: real-time polling status, start/stop controls, live error log display (max 200 lines)
- Printer settings tab: printer selection, manual printing, sample PDF testing
- Config window (config.html): edits config.json settings (also restarts polling on save)

**config.json** - Application configuration (not committed to repo, must be created)
- `pollInterval`: milliseconds between API polls (default: 5000)
- `apiHost`: API hostname only (e.g., "tani-hub.sakemaru.click"). Path "/api/printer/tasks" is automatically appended
- `apiToken`: Optional Bearer token for API authentication
- `printer0` ~ `printer3`: up to 4 printer slots for multi-printer support (0-indexed, can be empty strings)
- `s3`: AWS credentials object with `region`, `bucket`, `accessKeyId`, `secretAccessKey`

### Workflow

1. **Initialization**: App reads config.json, sets up menu bar, creates main window
   - **Auto-start**: If printer and API settings are configured, polling starts automatically (main.js:383-392)
   - Checks if at least one printer (printer0~3) is configured
   - Checks if apiAddress is set
   - Logs auto-start status and begins polling after 1 second delay
2. **Printer Configuration**: User switches to Printer Settings tab or opens config window (Sakemaru → ホーム menu)
   - Clicks "プリンタ一覧を読み込み" to load available printers from system
   - Assigns printers to slots 0-3 in config.json
   - Optional: Configure apiToken for Bearer authentication
   - Saves configuration (automatically restarts polling if active)
3. **Polling**: Starts automatically on launch or manually via Home tab start/stop buttons
   - Sends local IP to `apiAddress` as `printer_pc_id`
   - **New format**: If response contains `{printer_number: 0-3, file: "s3-key"}`, downloads PDF and prints to specified printer slot
   - If specified printer slot is empty, falls back to printer0
   - **Legacy format**: If response contains `{printer: [...], file: "s3-key"}`, prints to all printers in array
   - Deletes temp file after printing
4. **Monitoring**: Real-time logs shown in Home tab (last 200 lines) and written to daily log files

### Key Implementation Details

**Single Instance Lock**: main.js:18-38
- Prevents multiple instances of the app from running simultaneously
- Uses `app.requestSingleInstanceLock()` to enforce single instance
- When second instance is attempted, first instance window is shown and focused
- Second instance automatically quits

**System Tray (Background Operation)**: main.js:50-54, 407-520
- App runs in system tray and continues operation when all windows are closed
- Tray icon click: toggles main window visibility
- Tray menu: Show window, Start/Stop polling, Quit
- `window-all-closed` event is prevented to keep app running (main.js:597-601)
- Windows close button hides window instead of quitting (main.js:344-350)
- Only quits when "Quit" is selected from tray menu or app.quit() is called
- Polling continues in background even when all windows are hidden

**Windows Auto-start on Boot**: Uses `auto-launch` package (main.js:41-44, 566-577)
- Automatically registers app to start on Windows login (packaged builds only)
- Checks and enables auto-launch on first run
- Uses Windows Registry to register startup entry
- Only activates when `app.isPackaged === true` (production builds)

**Auto-start Polling**: `checkAutoStartConditions()` in main.js:528
- Validates configuration on app startup
- Checks for at least one configured printer (printer0~3)
- Checks for valid apiHost
- If conditions met, automatically starts polling after 1 second delay
- Logs auto-start status or configuration errors

**API URL Construction**: main.js:179
- API endpoint is built from `apiHost` config: `https://${config.apiHost}/api/printer/tasks`
- Users only need to enter hostname (e.g., "tani-hub.sakemaru.click")
- Path "/api/printer/tasks" is hardcoded and automatically appended

**IP Detection**: `getLocalIp()` in main.js:82 finds first non-internal IPv4 address

**Logging System**: `writeLog()` in main.js:60
- Writes timestamped logs to daily files in app userData directory (logs/log_YYYY-MM-DD.txt)
- Sends log events to UI via IPC for real-time display
- Log types: info, error, success

**Authentication**: API requests in main.js:139
- If `config.apiToken` is set, adds `Authorization: Bearer <token>` header to all API requests

**Multi-Printer Support**: `pollTask()` in main.js:136
- Supports up to 4 printer slots (printer0~3 in config.json, 0-indexed)
- API response with `printer_number` field routes to specific printer slot
- Falls back to printer0 if specified slot is unconfigured
- Maintains backward compatibility with array-based `printer` field

**Batch Printing with Parallel Downloads**: main.js:110-233
- New API format: Array of print jobs `[{file_url, printer_id, file_id, order}, ...]`
- Parallel download: Downloads up to 4 files concurrently using `downloadFilesInParallel()` (main.js:110-133)
- Order-based printing: Jobs sorted by `order` field and printed sequentially regardless of download completion order
- Sequential polling: Next poll only starts after all print jobs complete (prevents overlapping job batches)
- Recursive polling: Uses `setTimeout` instead of `setInterval` to ensure previous batch completes (main.js:238-251)

**Cross-platform Printing**: `printPdf()` in main.js:70
- Windows: uses `pdf-to-printer` library with fit settings
- macOS/Linux: shells out to `lp -d "printer" "file.pdf"`

**S3 Download**: `downloadFromS3()` in main.js:99
- Uses @aws-sdk/client-s3 with credentials from config.json
- Downloads to temp directory (`app.getPath('temp')`)
- Returns local file path

**IPC Communication**: Preload.js exposes safe API to renderer processes
- All main process functionality accessed via `window.electronAPI.*` methods
- Available APIs: getPrinters, printToPrinter, startPolling, stopPolling, downloadSamplePdf, loadConfig, saveConfig, onPollStatus
- Renderer uses IPC to trigger actions; main process sends status updates back
- Main window receives real-time updates via `poll-status` IPC channel (renderer.js:73)
- IPC handlers defined in main.js:376-419

**Context Menu Support**: main.js:291-318
- Right-click context menu with copy/paste/select all support
- Enabled in editable fields and text selection areas
- Menu items dynamically enabled based on context

**Security Note**: Line 2 disables TLS certificate validation (`NODE_TLS_REJECT_UNAUTHORIZED = '0'`). This is insecure and should only be used in development/testing environments.

## API Response Formats

The application supports three API response formats for backward compatibility:

1. **Batch Format** (current): Array of print jobs
   ```json
   [
     {"file_url": "s3-key", "printer_id": "0", "file_id": "123", "order": 1},
     {"file_url": "s3-key", "printer_id": "1", "file_id": "124", "order": 2}
   ]
   ```

2. **Single Job with Printer Number** (legacy):
   ```json
   {"file": "s3-key", "printer_number": 0}
   ```

3. **Array of Printers** (legacy):
   ```json
   {"file": "s3-key", "printer": ["printer-name-1", "printer-name-2"]}
   ```

## Usage

### Normal Operation
1. **Start**: App appears in system tray (notification area, bottom-right on Windows)
2. **Open Window**: Click tray icon or right-click → "ウィンドウを表示"
3. **Close Window**: Click X button - app continues running in background
4. **Control Polling**: Right-click tray icon → "ポーリング開始/停止"
5. **Quit**: Right-click tray icon → "終了" (this is the only way to fully close the app)

### Background Behavior
- **Closing all windows does NOT quit the app** - it continues polling in background
- Check system tray for the app icon to verify it's still running
- Polling runs continuously in background, even with no windows open
- To completely stop the app, use "終了" from tray menu

## Common Issues

**App appears to close but is still running**: This is normal behavior. Check the system tray (notification area) for the app icon. Close windows hide the UI but keep the app running in background.

**Can't find system tray icon**: On Windows, the icon may be in the hidden icons area. Click the up arrow (^) in the notification area to see all tray icons.

**App won't start / Nothing happens when double-clicking**: Check if the app is already running in the system tray. Only one instance can run at a time. If you try to start a second instance, it will automatically quit and bring the first instance to the foreground.

**Printer not found**: Ensure printer drivers are installed and printer is online. On macOS/Linux, verify printer name matches `lpstat -p` output.

**S3 download fails**: Check config.json credentials, bucket name, and region. Verify S3 object key matches exactly.

**Polling not starting**: Check that config.json is valid JSON. Verify API endpoint is reachable and returns expected format.

**Authentication errors**: Ensure `apiToken` in config.json is valid if API requires Bearer authentication.

**Logs not appearing**: Check app userData directory for logs folder. On Windows: `%APPDATA%\sakemaru-local-printer\logs\`

**Build failures**: Ensure all dependencies are installed. For macOS, code signing may be required for distribution.

**Auto-start not working**:
- Ensure you're running the installed version (from `dist/酒まる印刷 Setup 1.0.0.exe`), not development mode
- Check Windows Startup settings: Task Manager → Startup tab → Look for "Sakemaru"
- Auto-launch only works with packaged builds (`app.isPackaged === true`)
- Check Windows Registry: `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`
