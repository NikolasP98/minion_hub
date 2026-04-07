# Tray API

> Source: https://blackboard.sh/electrobun/docs/apis/tray/

## Overview

The Tray API enables developers to create and manage system tray icons and menus.

## Basic Usage

```javascript
import { Tray } from "electrobun/bun";

const tray = new Tray({
  title: "Example Tray Item (click to create menu)",
  // This can be a views url or an absolute file path
  image: "views://assets/electrobun-logo-32-template.png",
  template: true,
  width: 32,
  height: 32,
});
```

## Constructor Options

### title
The text appearing in the system tray.

### image
An optional URL to an image. Use the `views://` schema for bundled local images.

### template
On macOS, template images use opacity to create adaptable black-and-white icons for light/dark modes. Full-color images display as-is.

### width and height
Set image dimensions for the system tray display.

## Methods

### setMenu(items)
Display the menu, typically after listening for `tray-clicked` events. Dynamically generate menus from state for toggling checkboxes.

### setTitle(title)
Update the text displayed in the system tray.

```javascript
tray.setTitle("New Status");
```

### setImage(url)
Update the tray icon image using `views://` URLs or absolute file paths.

```javascript
tray.setImage("views://assets/new-icon-32-template.png");
```

### setVisible(visible)
Show or hide the tray icon.

```javascript
tray.setVisible(false);  // Hide
tray.setVisible(true);   // Show
```

### getBounds()
Return the tray icon's bounding rectangle with `x`, `y`, `width`, and `height` properties.

```javascript
const bounds = tray.getBounds();
console.log(`Tray icon at (${bounds.x}, ${bounds.y}) size ${bounds.width}x${bounds.height}`);
```

### remove()
Permanently remove the tray icon from the system tray.

```javascript
tray.remove();
```

## Menu Items

Refer to the [Application Menu](./15-application-menu-api.md) documentation for available menu item properties.

## Events

### tray-clicked

Fires when the system tray icon or menu item is clicked. The event data includes an `action` property -- empty string for icon clicks, or the menu item's action name.

```javascript
tray.on("tray-clicked", (e) => {
  const { id, action } = e.data;

  if (action === "") {
    console.log("Tray icon clicked");
  } else {
    console.log("Menu item clicked:", action);
  }
});
```
