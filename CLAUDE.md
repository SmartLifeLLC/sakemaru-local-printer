# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BZCorePrinter is an Electron-based desktop application that acts as a local print agent for the booze-core system. It polls a remote API for print jobs, downloads PDF files from S3, and prints them to configured local printers. The app supports Windows (using `pdf-to-printer`), macOS, and Linux (using `lp` command).

## Development Commands

### Running the Application
```bash
npm start                 # Launch Electron app in development mode
```

### Building
```bash
npm run build            # Build distributable using electron-builder
                         # Output: dist/mac-arm64/ (macOS) or dist/win-unpacked/ (Windows)
```

### Installing Dependencies
```bash
npm install              # Install all dependencies
```

## Architecture

### Core Files and Responsibilities

**main.js** - Main process entry point
- Manages three Electron windows: main (index.html), config (config.html), and status (status.html)
- Implements polling mechanism via `pollTask()` that runs at intervals defined in config.json
- Handles S3 file downloads using AWS SDK v3
- Cross-platform printing: `pdf-to-printer` for Windows, `lp` command for macOS/Linux
- IPC handlers for renderer communication
- Menu bar configuration for app navigation

**preload.js** - Security bridge between main and renderer processes
- Exposes controlled API via `contextBridge` to renderer
- Prevents direct access to Node.js APIs from renderer for security

**renderer.js** - UI logic for all three windows
- Detects which window is loaded by checking for specific DOM elements
- Main window (index.html): printer selection, manual printing, sync, polling start/stop buttons
- Config window (config.html): edits config.json settings (also restarts polling on save)
- Status window (status.html): displays real-time polling logs via IPC events

**config.json** - Application configuration
- `pollInterval`: milliseconds between API polls
- `apiAddress`: endpoint to fetch print tasks (POST with printer_pc_id)
- `syncApiAddress`: endpoint to sync printer list
- `printer1` ~ `printer4`: up to 4 printer slots for multi-printer support
- `s3`: AWS credentials and bucket info for downloading PDFs

### Workflow

1. **Initialization**: App reads config.json, sets up menu bar, creates main window
2. **Printer Configuration**: User opens config window (BZPrinter → 設定)
   - Clicks "プリンタ一覧を読み込み" to load available printers
   - Assigns printers to slots 1-4
   - Saves configuration
3. **Printer Sync**: User clicks "SYNC PRINTER LIST" on main window to send available printers to remote API
4. **Polling**: User starts polling via menu (BZPrinter → 開始) or main window button
   - Sends local IP to `apiAddress` as `printer_pc_id`
   - **New format**: If response contains `{printer_number: 1-4, file: "s3-key"}`, downloads PDF and prints to specified printer slot
   - If specified printer slot is empty, falls back to printer1
   - **Legacy format**: If response contains `{printer: [...], file: "s3-key"}`, prints to all printers in array
   - Deletes temp file after printing
5. **Status**: Real-time logs shown in status window via IPC events

### Key Implementation Details

**IP Detection**: `getLocalIp()` in main.js:25 finds first non-internal IPv4 address

**Multi-Printer Support**: `pollTask()` in main.js:76-118
- Supports up to 4 printer slots (printer1~4 in config.json)
- API response with `printer_number` field routes to specific printer slot
- Falls back to printer1 if specified slot is unconfigured
- Maintains backward compatibility with array-based `printer` field

**Cross-platform Printing**: `printPdf()` in main.js:36
- Windows: uses `pdf-to-printer` library with fit settings
- macOS/Linux: shells out to `lp -d "printer" "file.pdf"`

**S3 Download**: `downloadFromS3()` in main.js:65
- Uses @aws-sdk/client-s3 with credentials from config.json
- Downloads to temp directory (`app.getPath('temp')`)
- Returns local file path

**IPC Communication**: Preload.js exposes safe API to renderer processes (main.js:159-180)
- All main process functionality accessed via `window.electronAPI.*` methods
- Renderer uses IPC to trigger actions; main process sends status updates back
- Status window receives real-time updates via `poll-status` IPC channel

**Error Handling**: Polling errors are caught and sent to status window (main.js:92-95)

**Security Note**: Line 2 disables TLS certificate validation (`NODE_TLS_REJECT_UNAUTHORIZED = '0'`). This is insecure and should only be used in development/testing environments.

## Common Issues

**Printer not found**: Ensure printer drivers are installed and printer is online. On macOS/Linux, verify printer name matches `lpstat -p` output.

**S3 download fails**: Check config.json credentials, bucket name, and region. Verify S3 object key matches exactly.

**Polling not starting**: Check that config.json is valid JSON. Verify API endpoint is reachable and returns expected format.

**Build failures**: Ensure all dependencies are installed. For macOS, code signing may be required for distribution.
