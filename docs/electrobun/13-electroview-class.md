# Electroview Class (Browser-side API)

> Source: https://blackboard.sh/electrobun/docs/apis/browser/electroview-class/

## Overview

The Electroview Class enables instantiation of Electrobun APIs within the browser context.

```typescript
import { Electroview } from "electrobun/view";

const electrobun = new Electroview({ ...options });
```

## Constructor Options

### rpc

Enables typed RPC communication between the main Bun process and a BrowserView's browser context.

**Type Definition Example:**

```typescript
// src/shared/types.ts
export type MyWebviewRPCType = {
  bun: RPCSchema<{
    requests: {
      someBunFunction: {
        params: { a: number; b: number };
        response: number;
      };
    };
    messages: {
      logToBun: { msg: string };
    };
  }>;
  webview: RPCSchema<{
    requests: {
      someWebviewFunction: {
        params: { a: number; b: number };
        response: number;
      };
    };
    messages: {
      logToWebview: { msg: string };
    };
  }>;
};
```

**Browser-side Implementation:**

```typescript
// /src/myview/index.ts
import { Electroview } from "electrobun/view";
import { type MyWebviewRPCType } from "../shared/types";

const rpc = Electroview.defineRPC<MyWebviewRPCType>({
  handlers: {
    requests: {
      someWebviewFunction: ({ a, b }) => {
        document.body.innerHTML += `bun asked me to do math with ${a} and ${b}\n`;
        return a + b;
      },
    },
    messages: {
      logToWebview: ({ msg }) => {
        console.log(`bun asked me to logToWebview: ${msg}`);
      },
    },
  },
});
const electroview = new Electroview({ rpc });
```

**Calling Bun Functions:**

```typescript
electroview.rpc.request.someBunFunction({ a: 9, b: 8 }).then((result) => {
  console.log("result: ", result);
});

// or
electroview.rpc.send.logToBun({ msg: "hi from browser" });
```

## Static Methods

### defineRPC

Generates typed RPC and messaging functions for browser-to-Bun communication and establishes handler types for browser-side functions.

## Instance Methods

### Browser to Browser RPC

Electrobun doesn't provide browser to browser RPC out of the box as they favour isolation between browser contexts for greater security. Alternative communication patterns include:

- Routing through Bun
- Utilizing localStorage
- Establishing WebRTC connections between contexts
