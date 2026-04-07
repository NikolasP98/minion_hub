# Creating UI

> Source: https://blackboard.sh/electrobun/docs/guides/creating-ui/

This guide continues from the Hello World tutorial, demonstrating how to build a simple web browser using Electrobun by adding user interface elements.

## Setting Up the Main UI

Create a new directory structure at `src/main-ui/` with an `index.ts` file. The Electrobun CLI automatically transpiles this TypeScript into JavaScript, accessible at `views://main-ui/index.js`.

## TypeScript Implementation

```typescript
import { Electroview } from "electrobun/view";

// Instantiate the electrobun browser api
const electrobun = new Electroview({ rpc: null });

window.loadPage = () => {
  const newUrl = document.querySelector("#urlInput").value;
  const webview = document.querySelector(".webview");
  webview.src = newUrl;
};

window.goBack = () => {
  const webview = document.querySelector(".webview");
  webview.goBack();
};

window.goForward = () => {
  const webview = document.querySelector(".webview");
  webview.goForward();
};
```

## HTML Structure

Create an HTML file to load into the BrowserView:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Web Browser</title>
    <script src="views://main-ui/index.js"></script>
</head>
<body>
    <h1>My Web Browser</h1>
    <input type="text" id="urlInput" placeholder="Enter URL">
    <button onclick="loadPage()">Go</button>
    <button onclick="goBack()">Back</button>
    <button onclick="goForward()">Forward</button>

    <electrobun-webview class="webview" width="100%" height="100%" src="https://electrobun.dev">
    </electrobun-webview>
</body>
</html>
```

## Configuration Update

Modify `electrobun.config.ts` to include transpilation and file copying:

```typescript
export default {
  app: {
    name: "My App",
    identifier: "dev.my.app",
    version: "0.0.1",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      "main-ui": {
        entrypoint: "src/main-ui/index.ts",
      },
    },
    copy: {
      "src/main-ui/index.html": "views/main-ui/index.html",
    },
  },
};
```

## Bun Process Update

Update the main bun file to load the HTML:

```typescript
import { BrowserWindow } from "electrobun/bun";

const win = new BrowserWindow({
  title: "Hello Electrobun",
  url: "views://main-ui/index.html",
});
```

## Adding Application Menu

To enable standard keyboard shortcuts (cmd+c, cmd+v, cmd+a), add an ApplicationMenu:

```typescript
import { BrowserWindow, ApplicationMenu } from "electrobun/bun";

ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: "Quit", role: "quit" }],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      {
        label: "Custom Menu Item  🚀",
        action: "custom-action-1",
        tooltip: "I'm a tooltip",
      },
      {
        label: "Custom menu disabled",
        enabled: false,
        action: "custom-action-2",
      },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
]);

const win = new BrowserWindow({
  title: "Hello Electrobun",
  url: "views://main-ui/index.html",
});
```

## Running the Application

Execute `bun start` to rebuild and launch the application. Test functionality by entering URLs and using navigation buttons.
