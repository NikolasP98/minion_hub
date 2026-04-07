# Global Properties (Browser-side)

> Source: https://blackboard.sh/electrobun/docs/apis/browser/global-properties/

## Overview

Global properties are automatically injected into the browser context, regardless of whether you've instantiated the `Electroview`.

## Available Properties

### window.__electrobunWebviewId

This property contains the unique identifier of the webview instance.

### window.__electrobunWindowId

This property contains the unique identifier of the window.

## Context

These properties are injected by Electrobun's runtime and are accessible to all scripts running within the browser context. They enable developers to identify and reference specific webview and window instances programmatically.
