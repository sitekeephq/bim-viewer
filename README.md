# @7dimensions-project/bim-viewer

Shared BIM viewer engine, tools and React HUD for 7Dimensions products. It owns
the Three.js / That Open lifecycle, Fragments loading, selection, BCF-compatible
viewpoints, plan/walk navigation, sections, measurements, visibility and the
view cube. Product APIs, routing, authentication and branding stay in hosts.

## Install

```bash
npm install @7dimensions-project/bim-viewer
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
import { ViewerCanvas } from "@7dimensions-project/bim-viewer/react";
import "@7dimensions-project/bim-viewer/styles.css";

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
import type { ViewerExtension } from "@7dimensions-project/bim-viewer";

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
call `dispose()` when the host unmounts. The root export also includes complete
package-owned viewpoint/section/measurement types and `rebaseViewpoint`.

## Viewer tools and HUD

```tsx
import { ViewerToolsHud, useViewerTools } from "@7dimensions-project/bim-viewer/react";
import { toolMoreItems } from "@7dimensions-project/bim-viewer/tools";
import "@7dimensions-project/bim-viewer/tools.css";

const viewerTools = useViewerTools(engine, {
  loaded: engine?.loadedIds ?? [],
  onFit: () => void engine?.fit(),
  storeyLoader: (modelId) => myApi.loadStoreys(modelId),
});

<ViewerToolsHud
  {...viewerTools}
  loaded={!!engine?.loadedIds.length}
  branding={<MyBrandMark />}
  aboutText="Viewer attribution and product information"
/>;
```

`PropertiesPanel` accepts a `classLabel` function for host localization.
`storeyLoader`, branding and about copy are optional; no product API or brand
module is imported by this package.

The `./tools` entry point exports `ViewerTools`, section/measurement/walk
controllers, pure storey/walk/shortcut helpers, viewpoint-extra serializers and
phone-menu descriptors. Generic 4D/5D simulation painting, cost heat maps and
canvas recording are exported from the same entry point; hosts provide schedule
and cost data.

## Assets and styles

`styles.css` contains the canvas base styles. `tools.css` contains the reusable
HUD/tool styles and uses host theme variables such as `--primary`, `--surface`,
`--text`, `--border`, `--radius` and `--shadow`.

The worker URL is configurable through `ViewerEngine.create(..., { workerUrl })`
or `<ViewerCanvas workerUrl="..." />`. The default is
`/fragments-worker.mjs`.

## Boundaries

- Shared: renderer lifecycle, fragments, camera, selection, viewpoints,
  navigation, generic coloring, sections/measurement/visibility tools, HUD and
  extension contracts.
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
