# Paths API

> Source: https://blackboard.sh/electrobun/docs/apis/paths/

## Overview

Global paths exposed by Electrobun for accessing bundled resources and application files.

## Import

```javascript
import PATHS from "electrobun/bun";
```

## Available Paths

### PATHS.RESOURCES_FOLDER

In a macOS bundle, this directory contains static bundled resources.

> **Important:** You shouldn't modify or write to the bundle at runtime as it will affect code signing integrity.

### PATHS.VIEWS_FOLDER

Typically, the `views://` URL scheme maps to `RESOURCES_FOLDER + '/app/views/'`.

This path may be useful in Bun contexts where you need to read files directly, rather than using the URL scheme approach.

## Usage Context

These paths are primarily used within the Bun runtime environment (server-side) for accessing application resources. For browser-based view access, the `views://` URL scheme is generally the preferred approach.
