# Bundled Assets (views:// Schema)

> Source: https://blackboard.sh/electrobun/docs/apis/bundled-assets/

## Overview

The `views://` schema in Electrobun provides a robust method for handling static assets, ensuring they are securely and efficiently managed within the application's bundle.

You can think of the `views://` schema as an alternative to `https://` so it can be used in the context of BrowserViews anywhere a normal URL can be used and Electrobun will securely map those paths to the static asset folder in your application bundle.

## Using views:// in BrowserWindow URLs

```javascript
const { BrowserWindow } = require("electrobun");

const mainWindow = new BrowserWindow({
  width: 800,
  height: 600,
  title: "Main Window",
});

mainWindow.loadURL("views://mainview/index.html");
```

## Incorporating CSS and JavaScript

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Sample Page</title>
    <link rel="stylesheet" href="views://mainview/style.css" />
    <script src="views://mainview/script.js"></script>
    <style>
      div {
        background: url(views://mainview/somebg.png);
      }
    </style>
  </head>
  <body>
    <h1>Welcome to Electrobun</h1>
  </body>
</html>
```

The `views://` URL can be used directly in CSS just like any `https://` URL.

## Configuration

The `electrobun.config` file configures views and asset copying:

```javascript
build: {
    views: {
        mainview: {
            entrypoint: "src/mainview/index.ts",
        },
    },
    copy: {
        "src/mainview/index.html": "views/mainview/index.html",
        "src/mainview/style.css": "views/mainview/style.css",
        "src/mainview/script.js": "views/mainview/script.js",
    },
}
```

The property name for each view (e.g., `mainview`) maps directly to the path used when referencing a file. In the `copy` section, the destination `views/mainview/` maps to the URL `views://mainview/`.
