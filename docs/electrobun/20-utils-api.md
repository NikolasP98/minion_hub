# Utils API

> Source: https://blackboard.sh/electrobun/docs/apis/utils/

## Overview

The Utils module provides various utilities for Electrobun applications.

```typescript
import { Utils } from "electrobun/bun";
```

## File & Folder Operations

### moveToTrash(absolutePath)
Moves files or folders to the system trash/recycle bin.

### showItemInFolder(absolutePath)
Opens the file manager and selects the specified file or folder.

### openExternal(url)
Opens URLs in default browser or appropriate application. Supports `http://`, `https://`, `mailto:`, custom URL schemes, and file protocols.

**Returns:** `boolean` - true if successful

```javascript
Utils.openExternal("https://example.com");
Utils.openExternal("mailto:[email protected]?subject=Help");
Utils.openExternal("slack://open");
```

### openPath(path)
Opens files/folders with default application. Files open with associated apps (e.g., PDFs), folders open in file manager.

**Returns:** `boolean` - true if successful

```javascript
Utils.openPath("/Users/me/Documents/report.pdf");
Utils.openPath("/Users/me/Downloads");
```

> **Difference:** `openExternal()` takes URLs with protocols; `openPath()` takes file system paths.

## Notifications

### showNotification(options)
Displays native desktop notifications.

**Options:**
- `title` (string, required): Notification title
- `body` (string, optional): Main body text
- `subtitle` (string, optional): Subtitle
- `silent` (boolean, optional): Suppress sound if true

```javascript
Utils.showNotification({
  title: "New Message",
  body: "You have a new message from John"
});

Utils.showNotification({
  title: "Sync Complete",
  body: "All files have been synchronized",
  silent: true
});
```

**Platform Notes:**
- macOS: Uses NSUserNotificationCenter
- Windows: Uses Shell balloon notifications
- Linux: Uses `notify-send` command

## Dialogs

### openFileDialog(options)
Opens file selection dialog, returning chosen paths.

```javascript
const chosenPaths = await Utils.openFileDialog({
  startingFolder: join(homedir(), "Desktop"),
  allowedFileTypes: "*",
  canChooseFiles: true,
  canChooseDirectory: false,
  allowsMultipleSelection: true,
});
```

### showMessageBox(options)
Displays native message box with custom buttons and returns user response.

**Options:**
- `type`: `"info" | "warning" | "error" | "question"` (default: "info")
- `title` (string): Dialog title
- `message` (string): Main message
- `detail` (string): Additional detail text
- `buttons` (string[]): Button labels (default: ["OK"])
- `defaultId` (number): Default focused button index
- `cancelId` (number): Button index returned on cancel

**Returns:** `Promise<{ response: number }>` - 0-based index of clicked button

```javascript
const { response } = await Utils.showMessageBox({
  type: "question",
  title: "Confirm Delete",
  message: "Are you sure you want to delete this file?",
  detail: "This action cannot be undone.",
  buttons: ["Delete", "Cancel"],
  defaultId: 1,
  cancelId: 1
});

if (response === 0) {
  console.log("Deleting file...");
}
```

## macOS Dock Control

### setDockIconVisible(visible)
Show or hide app's Dock icon.

### isDockIconVisible()
Check if Dock icon is visible.

```javascript
Utils.setDockIconVisible(false);  // Hide
if (Utils.isDockIconVisible()) {
  console.log("App is visible in Dock");
}
```

## Application Control

### quit()
Gracefully quits the application, firing `before-quit` event (cancellable) and performing native cleanup.

```javascript
Utils.quit();
```

## Clipboard API

### clipboardReadText()
Read text from system clipboard.

### clipboardWriteText(text)
Write text to system clipboard.

### clipboardReadImage()
Read image from clipboard as PNG data, returning `Uint8Array` or null.

### clipboardWriteImage(pngData)
Write PNG image data (Uint8Array) to clipboard.

### clipboardClear()
Clear clipboard contents.

### clipboardAvailableFormats()
Get available clipboard formats as string array. Possible values: `"text"`, `"image"`, `"files"`, `"html"`.

## Paths (Utils.paths)

Cross-platform access to OS directories and app-scoped directories. All properties are synchronous getters.

```javascript
console.log(Utils.paths.home);
console.log(Utils.paths.downloads);
console.log(Utils.paths.userData);
```

### OS Directories

| Path | macOS | Windows | Linux |
|------|-------|---------|-------|
| `home` | ~ | %USERPROFILE% | ~ |
| `appData` | ~/Library/Application Support | %LOCALAPPDATA% | $XDG_DATA_HOME or ~/.local/share |
| `config` | ~/Library/Application Support | %APPDATA% | $XDG_CONFIG_HOME or ~/.config |
| `cache` | ~/Library/Caches | %LOCALAPPDATA% | $XDG_CACHE_HOME or ~/.cache |
| `temp` | $TMPDIR | %TEMP% | /tmp |
| `logs` | ~/Library/Logs | %LOCALAPPDATA% | $XDG_STATE_HOME or ~/.local/state |
| `documents` | ~/Documents | %USERPROFILE%\Documents | $XDG_DOCUMENTS_DIR or ~/Documents |
| `downloads` | ~/Downloads | %USERPROFILE%\Downloads | $XDG_DOWNLOAD_DIR or ~/Downloads |
| `desktop` | ~/Desktop | %USERPROFILE%\Desktop | $XDG_DESKTOP_DIR or ~/Desktop |
| `pictures` | ~/Pictures | %USERPROFILE%\Pictures | $XDG_PICTURES_DIR or ~/Pictures |
| `music` | ~/Music | %USERPROFILE%\Music | $XDG_MUSIC_DIR or ~/Music |
| `videos` | ~/Movies | %USERPROFILE%\Videos | $XDG_VIDEOS_DIR or ~/Videos |

### App-Scoped Directories

Scoped using `identifier` and `channel` from app's `version.json`:

```javascript
Utils.paths.userData   // {appData}/{identifier}/{channel}
Utils.paths.userCache  // {cache}/{identifier}/{channel}
Utils.paths.userLogs   // {logs}/{identifier}/{channel}
```

## GlobalShortcut

Register global keyboard shortcuts working even when app lacks focus.

```javascript
import { GlobalShortcut } from "electrobun/bun";
```

### register(accelerator, callback)
Register global keyboard shortcut. Returns `boolean`.

### unregister(accelerator)
Unregister a previously registered shortcut.

### unregisterAll()
Unregister all app shortcuts.

### isRegistered(accelerator)
Check if shortcut is currently registered.

### Accelerator Syntax

**Modifiers:** `Command`/`Cmd`, `Control`/`Ctrl`, `CommandOrControl`/`CmdOrCtrl`, `Alt`/`Option`, `Shift`, `Super`/`Meta`/`Win`

**Keys:** A-Z, 0-9, F1-F12, Space, Enter, Tab, Escape, Backspace, Delete, Up, Down, Left, Right, Home, End, PageUp, PageDown, and various symbols.

## Screen

Provides information about connected displays and cursor position.

```javascript
import { Screen } from "electrobun/bun";
```

### getPrimaryDisplay()
Returns primary display with `bounds`, `workArea`, `scaleFactor`, `isPrimary`.

### getAllDisplays()
Returns array of all connected displays.

### getCursorScreenPoint()
Returns current cursor position `{ x, y }`.

## Session

Manages cookies and storage for webview partitions with isolated storage per partition.

```javascript
import { Session } from "electrobun/bun";
```

### fromPartition(name)
Get or create session. Use `persist:` prefix for persistent sessions.

### defaultSession
Get default session.

### session.cookies.get(filter?)
Get cookies matching optional filter.

### session.cookies.set(cookie)
Set a cookie with name, value, domain, path, secure, httpOnly, sameSite, expirationDate.

### session.cookies.remove(url, name)
Remove specific cookie.

### session.cookies.clear()
Clear all cookies.

### session.clearStorageData(types?)
Clear storage data. Types: `'cookies'`, `'localStorage'`, `'sessionStorage'`, `'indexedDB'`, `'webSQL'`, `'cache'`, `'all'`.
