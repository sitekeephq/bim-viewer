# @7dimensions/bim-viewer

Shared BIM rendering engine for 7Dimensions web products. The package owns the
Three.js / That Open world lifecycle, fragments loading, selection, camera and
generic visualization primitives. Product APIs, routing, authentication and
feature UI stay in the consuming applications.

## Install

```bash
npm install @7dimensions/bim-viewer
```

React is a peer dependency. The renderer dependencies are package-owned so the
viewer can be introduced into products that still contain a legacy That Open
stack. Aligned hosts deduplicate the same versions during installation.

Copy the fragments worker to the host's public directory:

```bash
node node_modules/@7dimensions/bim-viewer/scripts/copy-assets.mjs public
```

## React

```tsx
import { ViewerCanvas } from "@7dimensions/bim-viewer/react";
import "@7dimensions/bim-viewer/styles.css";

export function ModelViewer() {
  return (
    <ViewerCanvas
      workerUrl="/fragments-worker.mjs"
      onReady={(engine) => void engine.load("model", "/models/site.frag")}
      onSelectionChange={(selection) => console.log(selection)}
    />
  );
}
```

`extensions` add host-specific behavior without adding application dependencies
to the shared package:

```ts
import type { ViewerExtension } from "@7dimensions/bim-viewer";

export const issuePins: ViewerExtension = {
  id: "cde-issue-pins",
  activate({ engine }) {
    engine.setPins([]);
    return () => engine.setPins([]);
  },
};
```

Keep extension arrays referentially stable in React (module constants or
`useMemo`), because changing the array intentionally recreates the viewer.

## Core API

Use `ViewerEngine.create(container, options)` directly outside React. Always
call `dispose()` when the host unmounts.

## Boundaries

- Shared: renderer lifecycle, fragments, camera, selection, generic coloring,
  clipping/visibility and extension contracts.
- 7D CDE: issue, clash, schedule, comparison and model-set workflows.
- OpenBIM: LAS scans, route models, IoT sensors, heatmaps and project data.
- Never import a consumer's API client, store, route or domain DTO here.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```
