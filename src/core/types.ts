import type { ViewerExtension } from "../extensions/types.js";

export interface ViewerCameraState {
  position: [number, number, number];
  target: [number, number, number];
  projection: "perspective" | "orthographic";
}

export interface IssueViewpoint {
  camera: ViewerCameraState;
  fileVersionIds: string[];
  selection?: string[];
  snapshot?: string;
}

export interface ViewRule {
  classes: string[];
  fileIds?: string[];
  action: "hide" | "color" | "isolate";
  color?: string;
  opacity?: number;
}

export interface ViewerEngineOptions {
  /**
   * Public URL of the That Open Fragments worker.
   * Copy it with `npm run copy-assets` in the consuming application.
   */
  workerUrl?: string;
  /** Show the renderer vendor wordmark. Disabled by default in product UIs. */
  showVendorLogo?: boolean;
}

export interface ViewerRuntimeOptions extends ViewerEngineOptions {
  extensions?: readonly ViewerExtension[];
}
