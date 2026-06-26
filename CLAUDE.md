# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sakemaru Local Printer (formerly BZCorePrinter) is an Electron-based desktop application that acts as a local print agent for the Sakemaru system. It runs as a **background system tray application** that polls a remote API for print jobs, downloads PDF files from S3, and prints them to configured local printers. The app supports Windows (using `pdf-to-printer` or `SumatraPDF`), macOS, and Linux (using `lp` command). Features include:
- Background operation via system tray (continues running when windows are closed)
- Batch printing with parallel downloads (up to 4 concurrent)
- Multi-printer support (up to 10 printers, printer0~printer9)
- Client UUID-based identification (X-Client-Id header)
- Warehouse ID filtering (optional)
- Bearer token authentication
- File-based daily logging
- Windows auto-start on system boot
- Auto-polling on startup with printer validation
- Printer synchronization API support
- API connection testing

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
- Manages Electron windows: main (index.html with tabs), config (config.html), and status (status.html)
- Implements recursive polling mechanism via `pollLoop()` that runs at intervals defined in config.json
- Handles S3 file downloads using AWS SDK v3 with parallel download support (max 4 concurrent)
- Cross-platform printing:
  - Windows: `pdf-to-printer` library or direct `SumatraPDF` execution (configurable via `printMethod`)
  - macOS/Linux: `lp` command with A4 paper size and one-sided printing
- File-based logging system: daily log files stored in app userData directory (logs/log_YYYY-MM-DD.txt)
- IPC handlers for renderer communication (getPrinters, printToPrinter, startPolling, stopPolling, etc.)
- Menu bar with app navigation and context menu (copy/paste) support
- Bearer token authentication support for API requests (Authorization header)
- Client UUID generation and X-Client-Id header for API identification
- Printer validation on startup to verify configured printers exist in system
- System tray integration with polling controls

**preload.js** - Security bridge between main and renderer processes
- Exposes controlled API via `contextBridge` to renderer
- Prevents direct access to Node.js APIs from renderer for security

**renderer.js** - UI logic for all windows
- Detects which window is loaded by checking for specific DOM elements
- Tab navigation system for multi-tab interfaces
- Home tab: real-time polling status, start/stop controls, live error log display (max 200 lines)
- Printer settings tab: printer selection, manual printing, sample PDF testing
- Config window (config.html): edits config.json settings (also restarts polling on save)

**config.json** - Application configuration (stored in userData directory, auto-created with defaults)
- `clientId`: Automatically generated UUID for client identification (sent as X-Client-Id header)
- `pollInterval`: milliseconds between API polls (default: 5000)
- `apiHost`: API hostname only (e.g., "tani-hub.sakemaru.click"). Path "/api/printer/polling" is automatically appended
- `apiToken`: Optional Bearer token for API authentication (sent as Authorization header)
- `warehouseId`: Optional warehouse ID to filter print jobs (sent as query parameter)
- `printer0` ~ `printer9`: up to 10 printer slots for multi-printer support (0-indexed, can be empty strings)
- `printMethod`: Printing method for Windows - either 'pdf-to-printer' (default) or 'sumatra-direct'
- `sumatraPdfPath`: Path to SumatraPDF.exe when using 'sumatra-direct' method
- `s3`: AWS credentials object with `region`, `bucket`, `accessKeyId`, `secretAccessKey`

### Workflow

1. **Initialization**: App reads config.json from userData directory, sets up menu bar, creates main window and system tray
   - If config.json doesn't exist, creates it from defaults (or copies from project root config.json in dev mode)
   - Generates clientId UUID if not present (main.js:106-111)
   - **Auto-start**: If printer and API settings are configured, polling starts automatically (main.js:926-942)
   - Validates at least one printer (printer0~9) is configured via `checkAutoStartConditions()` (main.js:847-864)
   - Validates printer existence in system via `validatePrinterConfiguration()` (main.js:798-844)
   - Checks if apiHost is set and clientId exists
   - Logs auto-start status and begins polling after 1 second delay
2. **Printer Configuration**: User switches to Printer Settings tab or opens config window
   - Clicks "プリンタ一覧を読み込み" to load available printers from system
   - Assigns printers to slots 0-9 in config.json
   - Optional: Configure apiToken for Bearer authentication
   - Optional: Configure warehouseId to filter jobs by warehouse
   - Optional: Select printMethod (pdf-to-printer or sumatra-direct for Windows)
   - Saves configuration (stops polling but doesn't auto-restart)
3. **Polling**: Starts automatically on launch or manually via Home tab start/stop buttons or tray menu
   - Sends X-Client-Id header with clientId UUID
   - Appends warehouse_id query parameter if configured
   - **v2.2 format**: Array of jobs with server-specified printer_name or local printer_index routing
   - **Order-based printing**: Jobs sorted by `order` field and printed sequentially
   - **Parallel downloads**: Up to 4 files downloaded concurrently via `downloadFilesInParallel()` (main.js:298-322)
   - **Print completion reporting**: POST to `/api/printer/jobs/{id}/complete` with status (main.js:472-494)
   - Deletes temp files after printing
4. **Monitoring**: Real-time logs shown in Home tab (last 200 lines) and written to daily log files in userData/logs/

### Key Constants and Configuration

**File Locations:**
- Config file: `{userData}/config.json` (auto-created from defaults or dev config.json)
- Log directory: `{userData}/logs/` (daily files: `log_YYYY-MM-DD.txt`)
- Temp downloads: `{temp}/` (system temp directory)
- userData path on Windows: `%APPDATA%\sakemaru-local-printer\`

**Constants:**
- `MAX_PRINTERS = 10` (main.js:84) - Maximum number of printer slots (printer0~printer9)
- `MAX_CONCURRENT = 4` (main.js:299) - Maximum concurrent S3 downloads
- Default poll interval: 5000ms (5 seconds)
- API connection timeout: 10 seconds (test endpoint)
- Printer sync timeout: 15 seconds
- Default S3 region: ap-northeast-1

**Default Config Structure:**
```javascript
{
  clientId: '',              // Auto-generated UUID
  pollInterval: 5000,
  apiHost: '',
  apiToken: '',
  warehouseId: '',           // Optional warehouse filter
  printer0: '',              // Up to printer9
  printMethod: 'pdf-to-printer',  // or 'sumatra-direct'
  sumatraPdfPath: 'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
  s3: {
    bucket: '',
    region: 'ap-northeast-1',
    accessKeyId: '',
    secretAccessKey: ''
  }
}
```

### Key Implementation Details

**Single Instance Lock**: main.js:18-38
- Prevents multiple instances of the app from running simultaneously
- Uses `app.requestSingleInstanceLock()` to enforce single instance
- When second instance is attempted, first instance window is shown and focused
- Second instance automatically quits

**System Tray (Background Operation)**: main.js:683-795
- App runs in system tray and continues operation when all windows are closed
- Created via `createTray()` using logo.png (resized to 16x16 for Windows)
- Tray icon click: toggles main window visibility (main.js:740-751)
- Tray menu: Show window, Start/Stop polling, Quit (main.js:700-735)
- `window-all-closed` event is prevented to keep app running (main.js:946-950)
- Windows close button hides window instead of quitting (main.js:618-624)
- Only quits when "Quit" is selected from tray menu or app.quit() is called
- Polling continues in background even when all windows are hidden
- Menu updates dynamically via `updateTrayMenu()` to reflect polling status (main.js:755-795)

**Windows Auto-start on Boot**: Uses `auto-launch` package (main.js:42-45, 908-923)
- Automatically registers app to start on Windows login (packaged builds only)
- Checks and enables auto-launch on first run
- Uses Windows Registry to register startup entry
- Only activates when `app.isPackaged === true` (production builds)

**Auto-start Polling**: `checkAutoStartConditions()` in main.js:847-864
- Validates configuration on app startup
- Checks for at least one configured printer (printer0~9) via MAX_PRINTERS constant
- Checks for valid apiHost and clientId
- If conditions met, automatically starts polling after 1 second delay
- Validates printer existence via `validatePrinterConfiguration()` before starting
- Logs auto-start status or configuration errors

**Client ID Management**: main.js:51-133
- `generateClientId()` (main.js:52-54): Generates UUID using crypto.randomUUID()
- Auto-generates clientId on first run or if missing (main.js:106-111)
- `buildApiHeaders()` (main.js:114-133): Constructs API headers with X-Client-Id and optional Authorization
- ClientId persisted in config.json and preserved during config saves

**API URL Construction**: main.js:331-336
- API endpoint is built from `apiHost` config: `https://${config.apiHost}/api/printer/polling`
- If warehouseId is set, appends query parameter: `?warehouse_id={warehouseId}`
- Users only need to enter hostname (e.g., "tani-hub.sakemaru.click")
- Path "/api/printer/polling" is hardcoded and automatically appended

**IP Detection**: `getLocalIp()` in main.js:189-197 finds first non-internal IPv4 address

**Logging System**: `writeLog()` in main.js:167-186
- Writes timestamped logs to daily files in app userData directory (logs/log_YYYY-MM-DD.txt)
- Log file path generated by `getLogFilePath()` (main.js:161-164)
- Sends log events to UI via IPC for real-time display
- Log types: info, error, success

**Authentication**: `buildApiHeaders()` in main.js:114-133
- Always sends `X-Client-Id` header with clientId UUID
- If `config.apiToken` is set, adds `Authorization: Bearer <token>` header to all API requests
- Both headers used in polling, sync, and test API calls

**Multi-Printer Support**: `pollTask()` in main.js:325-547
- Supports up to 10 printer slots (printer0~9 in config.json, 0-indexed, MAX_PRINTERS=10 at line 84)
- **v2.2 format**: Server can specify printer_name directly (main.js:433-438)
- **Fallback**: Uses printer_index to look up local config (main.js:440-449)
- Falls back to printer0 if specified slot is unconfigured
- Maintains backward compatibility with legacy printer_number and printer array formats (main.js:517-541)

**Batch Printing with Parallel Downloads**: main.js:298-547
- **v2.2 API format**: Array of print jobs with `{id, print_type, file_path, printer_name, printer_index, routing_type, warehouse_id, order}`
- **Response parsing**: Handles `{success: true, data: [...], meta: {...}}` structure (main.js:371-406)
- **Parallel download**: Downloads up to 4 files concurrently using `downloadFilesInParallel()` (main.js:298-322)
- **Order-based printing**: Jobs sorted by `order` field and printed sequentially (main.js:408-512)
- **Print completion reporting**: POST to `/api/printer/jobs/{id}/complete` with success/error status (main.js:472-494)
- **Sequential polling**: Next poll only starts after all print jobs complete (prevents overlapping job batches)
- **Recursive polling**: `pollLoop()` uses `setTimeout` instead of `setInterval` to ensure previous batch completes (main.js:552-567)

**Cross-platform Printing**: `printPdf()` in main.js:200-277
- **Windows**: Configurable via `printMethod` setting
  - `pdf-to-printer` (default): Uses pdf-to-printer library with A4 fit settings (main.js:242-259)
  - `sumatra-direct`: Direct SumatraPDF execution with `-print-to` and `-print-settings` flags (main.js:206-240)
- **macOS/Linux**: Uses `lp` command with A4 paper size and one-sided printing (main.js:260-273)

**S3 Download**: `downloadFromS3()` in main.js:280-295
- Uses @aws-sdk/client-s3 with credentials from config.json
- Downloads to temp directory (`app.getPath('temp')`)
- Returns local file path
- Enhanced error messages with bucket/key information

**IPC Communication**: IPC handlers defined in main.js:968-1173
- **get-printers** (main.js:968-996): Returns system printer list, uses getPrintersAsync() or getPrinters() fallback
- **print-to-printer** (main.js:997): Triggers printPdf() function
- **load-config** (main.js:998): Returns current config.json
- **save-config** (main.js:999-1024): Saves config, preserves clientId, stops polling (doesn't auto-restart)
- **start-polling** (main.js:1025): Starts polling loop
- **stop-polling** (main.js:1026): Stops polling loop
- **get-app-version** (main.js:1027-1029): Returns app version
- **download-sample-pdf** (main.js:1030-1033): Downloads sample.pdf from S3
- **sync-printers** (main.js:1036-1099): POST to `/api/printer/warehouses/{id}/printers/sync` with client_uuid and printer list
- **test-api-connection** (main.js:1102-1173): GET to `/api/printer/test` endpoint for connection validation
- All main process functionality accessed via `window.electronAPI.*` methods in renderer

**Context Menu Support**: main.js:630-657
- Right-click context menu with copy/paste/select all/undo/redo support
- Enabled in editable fields and text selection areas
- Menu items dynamically enabled based on editFlags and selection state
- Separate menus for editable vs non-editable contexts

**Security Note**: Line 2 disables TLS certificate validation (`NODE_TLS_REJECT_UNAUTHORIZED = '0'`). This is insecure and should only be used in development/testing environments.

## API Endpoints and Formats

### Polling Endpoint
**GET** `https://{apiHost}/api/printer/polling?warehouse_id={warehouseId}` (warehouse_id optional)

**Request Headers:**
- `X-Client-Id`: Client UUID (required)
- `Authorization: Bearer {token}` (optional, if apiToken is configured)

**Response Format (v2.2):**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "print_type": "shipping_label",
      "file_path": "s3-key/path/to/file.pdf",
      "printer_driver_id": 456,
      "printer_name": "HP LaserJet Pro",
      "printer_index": 0,
      "routing_type": "warehouse_printer",
      "warehouse_id": 789,
      "buyer_id": 101,
      "buyer_name": "Example Buyer",
      "order": 1
    }
  ],
  "meta": {
    "count": 1
  }
}
```

### Print Completion Endpoint
**POST** `https://{apiHost}/api/printer/jobs/{id}/complete`

**Request Headers:** Same as polling endpoint

**Request Body (success):**
```json
{
  "status": "success",
  "printed_at": "2026-05-05T12:34:56.789Z",
  "printer_name": "HP LaserJet Pro"
}
```

**Request Body (error):**
```json
{
  "status": "error",
  "error_message": "Printer offline"
}
```

### Printer Sync Endpoint
**POST** `https://{apiHost}/api/printer/warehouses/{id}/printers/sync`

**Request Body:**
```json
{
  "client_uuid": "uuid-string",
  "printers": [
    {"index": 0, "name": "HP LaserJet Pro"},
    {"index": 1, "name": "Canon Printer"}
  ]
}
```

### Test Connection Endpoint
**GET** `https://{apiHost}/api/printer/test`

**Response:**
```json
{
  "success": true,
  "data": {
    "server_version": "2.2",
    "client_id": "uuid-string",
    "timestamp": "2026-05-05T12:34:56.789Z"
  }
}
```

### Legacy Response Formats (Backward Compatibility)

The application also supports legacy formats:

1. **Single Job with Printer Number** (legacy):
   ```json
   {"file": "s3-key", "printer_number": 0}
   ```

2. **Array of Printers** (legacy):
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

**Printer validation errors on startup**:
- Ensure printer drivers are installed and printers are online
- Check that printer names in config.json match system printer names exactly
- Use "プリンタ一覧を読み込み" button to refresh available printers
- If printer was recently added/removed, restart the app

**Client ID issues**:
- Client ID (UUID) is automatically generated on first run and stored in config.json
- If missing or corrupted, app will regenerate automatically
- Client ID is sent in X-Client-Id header for all API requests
- Client ID is preserved when saving config changes

**API connection test failures**:
- Use the "接続テスト" button in config window to diagnose connection issues
- Check if apiHost is correct (hostname only, no https:// prefix)
- Verify apiToken if authentication is required
- Test endpoint provides timeout after 10 seconds
- Check firewall/network settings if timeout occurs

**Warehouse ID filtering**:
- Set warehouseId in config.json to only receive jobs for specific warehouse
- Warehouse ID is sent as query parameter in polling requests
- Leave empty to receive all jobs associated with client ID

## Recent Changes and Version History

### v2.2 (Current)
- **Client UUID identification**: Auto-generated client UUID sent in X-Client-Id header
- **10 printer support**: Expanded from 4 to 10 printer slots (printer0~printer9)
- **Server-side printer routing**: API can now specify printer_name directly, bypassing local config
- **Warehouse ID filtering**: Optional warehouse_id parameter to filter jobs by warehouse
- **Printer synchronization API**: POST to `/api/printer/warehouses/{id}/printers/sync`
- **API connection testing**: GET to `/api/printer/test` for connection validation
- **Print completion reporting**: POST to `/api/printer/jobs/{id}/complete` with success/error status
- **Enhanced error handling**: Detailed error messages for API failures, timeouts, and network issues
- **Printer validation on startup**: Validates configured printers exist in system before starting polling
- **SumatraPDF direct printing**: Alternative Windows printing method via direct SumatraPDF execution
- **Config preservation**: clientId preserved during config saves

### v2.1
- **Batch printing with parallel downloads**: Download up to 4 PDFs concurrently
- **Order-based printing**: Jobs sorted by order field and printed sequentially
- **Structured API responses**: `{success, data, meta}` format
- **Recursive polling**: Sequential polling that waits for batch completion

### v2.0
- **Multi-printer support**: Support for up to 4 printers (later expanded to 10)
- **System tray integration**: Background operation with tray icon and menu
- **Auto-start polling**: Automatic polling on app startup if configured
- **Windows auto-launch**: Register for Windows startup on system boot
- **Daily log files**: Separate log file for each day

### v1.x (Legacy - BZCorePrinter)
- Basic polling and printing functionality
- Single printer support
- S3 download integration
- Bearer token authentication

## Important Behavioral Notes

### Configuration Changes
- When saving config via UI, polling is **stopped but NOT automatically restarted** (main.js:1015-1019)
- User must manually start polling after config changes via UI or tray menu
- clientId is **always preserved** during config saves (main.js:1003-1005)
- Config is auto-saved on app shutdown (main.js:963)

### Polling Behavior
- **Sequential polling**: Next poll only starts after current batch completes (prevents overlapping jobs)
- **Recursive implementation**: Uses setTimeout, not setInterval (main.js:552-567)
- **Continuous operation**: Polling continues even when all windows are closed
- **Automatic start**: Only starts on app launch if printers are configured and validated
- **Manual control**: Can be started/stopped via Home tab buttons or tray menu

### Error Handling
- Download failures are logged but don't stop batch processing
- Print failures are reported to server via completion API
- API errors are logged with full response body (first 500 chars)
- Network timeouts trigger specific error messages
- Missing printers fall back to printer0

### Background Operation
- App continues running when all windows are closed (not on macOS by default behavior)
- Only way to fully quit is via tray menu "終了" option or app.quit()
- Tray icon may be hidden in Windows notification area overflow (click ^ arrow)
- Single instance lock prevents multiple copies from running

### Security Considerations
- **TLS validation disabled** (line 2): Only for dev/testing, should be removed for production
- Config file contains S3 credentials and API tokens - stored in plain text
- No encryption for sensitive data in config.json
- Bearer token sent in Authorization header for all API requests
