/**
 * Thin wrapper around That Open Components 3.x: one world, federated Fragments models,
 * click selection, properties, pins and BCF-style viewpoints.
 */
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as THREE from "three";
import type { IssueViewpoint, ViewRule, ViewerEngineOptions } from "./types.js";

export interface SelectedItem {
  modelId: string;
  localId: number;
  globalId: string | null;
  category: string | null;
  name: string | null;
  /** Attribute groups for the properties panel: group name → [label, value][] */
  groups: { name: string; rows: [string, string][] }[];
}

type World = OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>;

export class ViewerEngine {
  readonly components = new OBC.Components();
  readonly world: World;
  readonly fragments: OBC.FragmentsManager;
  readonly highlighter: OBF.Highlighter;
  private readonly pins = new THREE.Group();
  private readonly clashMarker = new THREE.Group();
  /** Import offset of the first aligned model (model sets / clash view). */
  private baseOffset: THREE.Vector3 | null = null;
  private readonly aligned = new Set<string>();
  private pickHandler: ((e: MouseEvent) => void) | null = null;
  onSelect: (item: SelectedItem | null) => void = () => undefined;

  private constructor(
    private readonly container: HTMLElement,
    private readonly options: ViewerEngineOptions,
  ) {
    const worlds = this.components.get(OBC.Worlds);
    this.world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
    this.world.scene = new OBC.SimpleScene(this.components);
    this.world.scene.setup();
    this.world.scene.three.background = null;
    // preserveDrawingBuffer lets us take issue snapshots from the canvas.
    this.world.renderer = new OBC.SimpleRenderer(this.components, container, {
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.world.renderer.showLogo = this.options.showVendorLogo ?? false;
    this.world.camera = new OBC.OrthoPerspectiveCamera(this.components);
    this.components.init();
    this.components.get(OBC.Grids).create(this.world);
    this.world.scene.three.add(this.pins);
    this.world.scene.three.add(this.clashMarker);

    this.fragments = this.components.get(OBC.FragmentsManager);
    this.highlighter = this.components.get(OBF.Highlighter);
  }

  static async create(
    container: HTMLElement,
    options: ViewerEngineOptions = {},
  ): Promise<ViewerEngine> {
    const engine = new ViewerEngine(container, options);
    await engine.init();
    return engine;
  }

  private async init() {
    // The worker is copied next to the app (scripts/copy-worker.mjs) so it works offline.
    this.fragments.init(this.options.workerUrl ?? "/fragments-worker.mjs");
    this.world.camera.controls.addEventListener("rest", () => this.fragments.core.update(true));
    this.world.camera.controls.addEventListener("update", () => this.fragments.core.update());
    this.fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(this.world.camera.three);
      this.world.scene.three.add(model.object);
      this.fragments.core.update(true);
    });
    this.components.get(OBC.Raycasters).get(this.world);
    this.highlighter.setup({
      world: this.world,
      selectMaterialDefinition: { color: new THREE.Color("#e8a33d"), opacity: 1, transparent: false, renderedFaces: 0 },
    });
    this.highlighter.zoomToSelection = false;
    this.highlighter.events.select!.onHighlight.add((map) => void this.emitSelection(map));
    this.highlighter.events.select!.onClear.add(() => this.onSelect(null));
  }

  get loadedIds(): string[] {
    return [...this.fragments.list.keys()];
  }

  async load(modelId: string, url: string, onProgress?: (pct: number) => void): Promise<void> {
    if (this.fragments.list.has(modelId)) return;
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Model yüklenemedi (HTTP ${res.status})`);
    const buffer = await res.arrayBuffer();
    onProgress?.(60);
    await this.fragments.core.load(buffer, { modelId, camera: this.world.camera.three });
    onProgress?.(100);
  }

  async unload(modelId: string): Promise<void> {
    if (!this.fragments.list.has(modelId)) return;
    await this.highlighter.clear("select");
    await this.clearComparison();
    await this.fragments.core.disposeModel(modelId);
    this.aligned.delete(modelId);
    if (!this.aligned.size) this.baseOffset = null;
    this.fragments.core.update(true);
  }

  async fit(): Promise<void> {
    if (!this.fragments.list.size) return;
    await this.world.camera.fitToItems();
  }

  private async emitSelection(map: OBC.ModelIdMap) {
    const [modelId, ids] = Object.entries(map)[0] ?? [];
    const localId = ids ? [...ids][0] : undefined;
    if (!modelId || localId === undefined) return this.onSelect(null);
    const model = this.fragments.list.get(modelId);
    if (!model) return this.onSelect(null);
    const [data] = await model.getItemsData([localId], {
      attributesDefault: true,
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
        HasProperties: { attributes: true, relations: false },
        ContainedInStructure: { attributes: true, relations: false },
      },
      relationsDefault: { attributes: false, relations: false },
    });
    const [globalId] = await model.getGuidsByLocalIds([localId]);
    this.onSelect({
      modelId,
      localId,
      globalId: globalId ?? null,
      category: valueOf(data?._category),
      name: valueOf(data?.Name),
      groups: toGroups(data ?? {}),
    });
  }

  /** Current camera, loaded models and selection as an issue viewpoint (with a snapshot). */
  async viewpoint(): Promise<IssueViewpoint> {
    const controls = this.world.camera.controls;
    const pos = controls.getPosition(new THREE.Vector3());
    const target = controls.getTarget(new THREE.Vector3());
    const selection: string[] = [];
    const sel = this.highlighter.selection.select ?? {};
    for (const [modelId, ids] of Object.entries(sel)) {
      const model = this.fragments.list.get(modelId);
      if (!model) continue;
      const guids = await model.getGuidsByLocalIds([...ids]);
      selection.push(...guids.filter((g): g is string => !!g));
    }
    this.world.renderer!.three.render(this.world.scene.three, this.world.camera.three);
    const snapshot = this.snapshot();
    return {
      camera: {
        position: [pos.x, pos.y, pos.z],
        target: [target.x, target.y, target.z],
        projection: this.world.camera.projection.current === "Orthographic" ? "orthographic" : "perspective",
      },
      fileVersionIds: this.loadedIds,
      selection,
      snapshot,
    };
  }

  private snapshot(): string {
    const src = this.world.renderer!.three.domElement;
    const scale = Math.min(1, 960 / src.width);
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  }

  async applyViewpoint(vp: IssueViewpoint): Promise<void> {
    const [px, py, pz] = vp.camera.position;
    const [tx, ty, tz] = vp.camera.target;
    await this.world.camera.controls.setLookAt(px, py, pz, tx, ty, tz, true);
    await this.highlighter.clear("select");
    if (vp.selection?.length) {
      const map: OBC.ModelIdMap = {};
      for (const [modelId, model] of this.fragments.list) {
        const ids = (await model.getLocalIdsByGuids(vp.selection)).filter((x): x is number => x !== null);
        if (ids.length) map[modelId] = new Set(ids);
      }
      if (Object.keys(map).length) await this.highlighter.highlightByID("select", map, true, false);
    }
    this.fragments.core.update(true);
  }

  /** Waits for one click on the model and returns the hit point (for issue pins). */
  pickPoint(): Promise<{ point: [number, number, number]; modelId: string; globalId: string | null } | null> {
    this.cancelPick();
    this.highlighter.enabled = false;
    const canvas = this.world.renderer!.three.domElement;
    canvas.style.cursor = "crosshair";
    return new Promise((resolve) => {
      this.pickHandler = async (e: MouseEvent) => {
        // Fragments raycasting takes the pointer in client pixels and converts it itself.
        const mouse = new THREE.Vector2(e.clientX, e.clientY);
        const hit = await this.fragments.raycast({ camera: this.world.camera.three, mouse, dom: canvas });
        this.cancelPick();
        if (!hit) return resolve(null);
        const [globalId] = await hit.fragments.getGuidsByLocalIds([hit.localId]);
        resolve({ point: [hit.point.x, hit.point.y, hit.point.z], modelId: hit.fragments.modelId, globalId: globalId ?? null });
      };
      canvas.addEventListener("click", this.pickHandler, { once: true });
    });
  }

  cancelPick() {
    const canvas = this.world.renderer?.three.domElement;
    if (canvas && this.pickHandler) canvas.removeEventListener("click", this.pickHandler);
    this.pickHandler = null;
    if (canvas) canvas.style.cursor = "";
    this.highlighter.enabled = true;
  }

  /** Draws issue pins as small coloured spheres. */
  setPins(pins: { position: [number, number, number]; color: string }[]) {
    for (const child of [...this.pins.children]) {
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.pins.remove(m);
    }
    for (const p of pins) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 16, 12),
        new THREE.MeshBasicMaterial({ color: p.color, depthTest: false, transparent: true, opacity: 0.9 }),
      );
      mesh.renderOrder = 10;
      mesh.position.set(...p.position);
      this.pins.add(mesh);
    }
  }

  /**
   * Version comparison colours (Collaboration Pro "change visualization"): in the new
   * version added elements are green and changed ones orange, the rest optionally faded;
   * the old version, when loaded, is ghosted with removed elements in red. Uses highlighter
   * styles so a click selection still shows on top and the colours come back afterwards.
   */
  async showComparison(opts: {
    newModelId: string;
    added: string[];
    changed: string[];
    fadeUnchanged: boolean;
    oldModelId?: string | null;
    removed: string[];
  }): Promise<{ added: number; changed: number; removed: number }> {
    this.ensureCompareStyles();
    await this.clearComparison();
    const counts = { added: 0, changed: 0, removed: 0 };
    const paint = async (style: string, modelId: string, ids: number[]) => {
      if (ids.length) await this.highlighter.highlightByID(style, { [modelId]: new Set(ids) }, true, false);
    };
    const newModel = this.fragments.list.get(opts.newModelId);
    if (newModel) {
      const added = await localIds(newModel, opts.added);
      const changed = await localIds(newModel, opts.changed);
      counts.added = added.length;
      counts.changed = changed.length;
      await paint("cmp-added", opts.newModelId, added);
      await paint("cmp-changed", opts.newModelId, changed);
      if (opts.fadeUnchanged) {
        const skip = new Set([...added, ...changed]);
        await paint("cmp-faded", opts.newModelId, (await geometryIds(newModel)).filter((id) => !skip.has(id)));
      }
    }
    const oldModel = opts.oldModelId ? this.fragments.list.get(opts.oldModelId) : undefined;
    if (oldModel && opts.oldModelId) {
      const removed = await localIds(oldModel, opts.removed);
      counts.removed = removed.length;
      const skip = new Set(removed);
      await paint("cmp-removed", opts.oldModelId, removed);
      await paint("cmp-ghost", opts.oldModelId, (await geometryIds(oldModel)).filter((id) => !skip.has(id)));
    }
    this.fragments.core.update(true);
    return counts;
  }

  async clearComparison(): Promise<void> {
    for (const style of COMPARE_STYLES) {
      if (this.highlighter.styles.has(style) && this.highlighter.selection[style]) await this.highlighter.clear(style);
    }
    this.fragments.core.update(true);
  }

  /** Selects (and zooms to) an element by GlobalId in the first of the given models that has it. */
  async focusGuid(guid: string, modelIds: string[]): Promise<boolean> {
    for (const id of modelIds) {
      const model = this.fragments.list.get(id);
      if (!model) continue;
      const [localId] = await model.getLocalIdsByGuids([guid]);
      if (localId === null || localId === undefined) continue;
      await this.highlighter.highlightByID("select", { [id]: new Set([localId]) }, true, true);
      return true;
    }
    return false;
  }

  /** Selects the elements with these GlobalIds in every loaded model (optionally zooming to them). */
  async selectGuids(guids: string[], zoom = true): Promise<number> {
    await this.highlighter.clear("select");
    const map: OBC.ModelIdMap = {};
    let count = 0;
    for (const [modelId, model] of this.fragments.list) {
      const ids = await localIds(model, guids);
      if (ids.length) {
        map[modelId] = new Set(ids);
        count += ids.length;
      }
    }
    if (count) await this.highlighter.highlightByID("select", map, true, zoom);
    this.fragments.core.update(true);
    return count;
  }

  /** GlobalIds of the current selection per model (model id = file version id). */
  async selectedGuids(): Promise<{ modelId: string; guids: string[] }[]> {
    const out: { modelId: string; guids: string[] }[] = [];
    for (const [modelId, ids] of Object.entries(this.highlighter.selection.select ?? {})) {
      const model = this.fragments.list.get(modelId);
      if (!model || !ids.size) continue;
      const guids = (await model.getGuidsByLocalIds([...ids])).filter((g): g is string => !!g);
      if (guids.length) out.push({ modelId, guids });
    }
    return out;
  }

  /**
   * 4D colouring: elements grouped by status (not started ghosted, in progress orange,
   * complete green, late red); elements linked to no activity optionally faded.
   */
  async show4D(groups: Record<FourDStatus, string[]>, fadeUnlinked: boolean): Promise<Record<FourDStatus, number>> {
    this.ensure4DStyles();
    await this.clear4D();
    const counts = { not_started: 0, in_progress: 0, complete: 0, late: 0 } as Record<FourDStatus, number>;
    for (const [modelId, model] of this.fragments.list) {
      const linked = new Set<number>();
      for (const status of Object.keys(counts) as FourDStatus[]) {
        const ids = await localIds(model, groups[status]);
        ids.forEach((id) => linked.add(id));
        counts[status] += ids.length;
        if (ids.length) await this.highlighter.highlightByID(`4d-${status}`, { [modelId]: new Set(ids) }, true, false);
      }
      if (fadeUnlinked) {
        const rest = (await geometryIds(model)).filter((id) => !linked.has(id));
        if (rest.length) await this.highlighter.highlightByID("4d-unlinked", { [modelId]: new Set(rest) }, true, false);
      }
    }
    this.fragments.core.update(true);
    return counts;
  }

  async clear4D(): Promise<void> {
    for (const style of FOURD_STYLES) {
      if (this.highlighter.styles.has(style) && this.highlighter.selection[style]) await this.highlighter.clear(style);
    }
    this.fragments.core.update(true);
  }

  private ensure4DStyles() {
    const styles = this.highlighter.styles;
    if (styles.has("4d-late")) return;
    const def = (hex: string, opacity: number, priority: number) => ({
      color: new THREE.Color(hex),
      opacity,
      transparent: opacity < 1,
      renderedFaces: 0 as const,
      priority,
    });
    styles.set("4d-unlinked", def(FOURD_COLORS.not_started, 0.08, -3));
    styles.set("4d-not_started", def(FOURD_COLORS.not_started, 0.2, -2));
    styles.set("4d-in_progress", def(FOURD_COLORS.in_progress, 1, 1));
    styles.set("4d-complete", def(FOURD_COLORS.complete, 1, 1));
    styles.set("4d-late", def(FOURD_COLORS.late, 1, 2));
  }

  private ensureCompareStyles() {
    const styles = this.highlighter.styles;
    if (styles.has("cmp-added")) return;
    const def = (hex: string, opacity: number, priority: number) => ({
      color: new THREE.Color(hex),
      opacity,
      transparent: opacity < 1,
      renderedFaces: 0 as const,
      priority,
    });
    styles.set("cmp-faded", def(COMPARE_COLORS.unchanged, 0.25, -2));
    styles.set("cmp-ghost", def(COMPARE_COLORS.unchanged, 0.12, -2));
    styles.set("cmp-added", def(COMPARE_COLORS.added, 1, 1));
    styles.set("cmp-changed", def(COMPARE_COLORS.changed, 1, 1));
    styles.set("cmp-removed", def(COMPARE_COLORS.removed, 1, 1));
  }

  // ------------------------------------------------------------------ model coordination

  /**
   * Federation: Fragments models keep the offset web-ifc moved them by on import
   * (COORDINATE_TO_ORIGIN). Aligning puts every model back into the first aligned model's
   * frame, so files that share project coordinates overlap like on the server (clash tests).
   */
  async align(modelId: string): Promise<void> {
    const model = this.fragments.list.get(modelId);
    if (!model || this.aligned.has(modelId)) return;
    // Marked before the await: the viewer's load effect can call this twice for one model.
    this.aligned.add(modelId);
    const own = await offsetOf(model);
    if (!this.fragments.list.has(modelId)) return;
    if (!this.baseOffset) {
      this.baseOffset = own;
      return;
    }
    // web-ifc's offsets are translations: place the model at (base offset − own offset).
    model.object.position.copy(this.baseOffset.clone().sub(own));
    model.object.updateMatrix();
    model.object.updateMatrixWorld(true);
    this.fragments.core.update(true);
  }

  /** IFC world point (metres, Z up) → viewer scene coordinates of a loaded model. */
  async ifcToScene(point: [number, number, number], modelId: string): Promise<THREE.Vector3 | null> {
    const model = this.fragments.list.get(modelId);
    if (!model) return null;
    const [x, y, z] = point;
    const v = new THREE.Vector3(x, z, -y).add(await offsetOf(model));
    return v.applyMatrix4(model.object.matrixWorld);
  }

  cameraState(): { position: [number, number, number]; target: [number, number, number]; projection: "perspective" | "orthographic" } {
    const controls = this.world.camera.controls;
    const pos = controls.getPosition(new THREE.Vector3());
    const target = controls.getTarget(new THREE.Vector3());
    return {
      position: [pos.x, pos.y, pos.z],
      target: [target.x, target.y, target.z],
      projection: this.world.camera.projection.current === "Orthographic" ? "orthographic" : "perspective",
    };
  }

  async setCamera(c: { position: [number, number, number]; target: [number, number, number] }): Promise<void> {
    await this.world.camera.controls.setLookAt(...c.position, ...c.target, true);
    this.fragments.core.update(true);
  }

  /** Saved-view rules by IFC class: hide, isolate or colour. modelFiles maps model (version) id → file id. */
  async applyRules(rules: ViewRule[], modelFiles: Record<string, string>): Promise<void> {
    await this.clearRules();
    for (const [modelId, model] of this.fragments.list) {
      const fileId = modelFiles[modelId];
      for (const rule of rules) {
        if (rule.fileIds?.length && (!fileId || !rule.fileIds.includes(fileId))) continue;
        const ids = rule.classes.length ? await idsOfClasses(model, rule.classes) : await model.getLocalIds();
        if (rule.action === "hide") {
          if (ids.length) await model.setVisible(ids, false);
        } else if (rule.action === "isolate") {
          await model.setVisible(undefined, false);
          if (ids.length) await model.setVisible(ids, true);
        } else if (ids.length) {
          await model.setColor(ids, new THREE.Color(rule.color ?? "#d92d20"));
          if (rule.opacity !== undefined && rule.opacity < 1) await model.setOpacity(ids, rule.opacity);
        }
      }
    }
    this.fragments.core.update(true);
  }

  async clearRules(): Promise<void> {
    for (const model of this.fragments.list.values()) {
      await model.resetVisible();
      await model.resetColor(undefined);
      await model.resetOpacity(undefined);
    }
    this.fragments.core.update(true);
  }

  /**
   * Clash view: isolates the two elements, colours A red and B blue, marks the clash point
   * and zooms to them. Returns false when an element is not found in its model.
   */
  async showClash(opts: {
    a: { modelId: string; globalId: string };
    b: { modelId: string; globalId: string };
    point?: [number, number, number];
    isolate?: boolean;
  }): Promise<boolean> {
    await this.clearClash();
    const styles = this.highlighter.styles;
    if (!styles.has("clash-a")) {
      const def = (hex: string) => ({ color: new THREE.Color(hex), opacity: 1, transparent: false, renderedFaces: 0 as const, priority: 2 });
      styles.set("clash-a", def(CLASH_COLORS.a));
      styles.set("clash-b", def(CLASH_COLORS.b));
    }
    const map: OBC.ModelIdMap = {};
    let found = 0;
    for (const [key, side] of [
      ["clash-a", opts.a],
      ["clash-b", opts.b],
    ] as const) {
      const model = this.fragments.list.get(side.modelId);
      if (!model) continue;
      const [localId] = await model.getLocalIdsByGuids([side.globalId]);
      if (localId === null || localId === undefined) continue;
      found++;
      (map[side.modelId] ??= new Set()).add(localId);
      await this.highlighter.highlightByID(key, { [side.modelId]: new Set([localId]) }, true, false);
    }
    if (!found) return false;
    if (opts.isolate !== false) await this.components.get(OBC.Hider).isolate(map);
    if (opts.point) {
      const p = await this.ifcToScene(opts.point, opts.a.modelId);
      if (p) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 16, 12),
          new THREE.MeshBasicMaterial({ color: "#f79009", depthTest: false, transparent: true, opacity: 0.95 }),
        );
        mesh.renderOrder = 11;
        mesh.position.copy(p);
        this.clashMarker.add(mesh);
      }
    }
    await this.world.camera.fitToItems(map);
    this.fragments.core.update(true);
    return found === 2;
  }

  /** Shows every element again but keeps the clash colours. */
  async showAll(): Promise<void> {
    await this.components.get(OBC.Hider).set(true);
    this.fragments.core.update(true);
  }

  async clearClash(): Promise<void> {
    for (const style of ["clash-a", "clash-b"]) {
      if (this.highlighter.styles.has(style) && this.highlighter.selection[style]) await this.highlighter.clear(style);
    }
    for (const child of [...this.clashMarker.children]) {
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.clashMarker.remove(m);
    }
    if (this.fragments.list.size) await this.components.get(OBC.Hider).set(true);
    this.fragments.core.update(true);
  }

  dispose() {
    this.cancelPick();
    this.components.dispose();
  }
}

/**
 * Translation web-ifc applied on import (COORDINATE_TO_ORIGIN): scene = IFC world (Y up) + offset.
 * Read from getCoordinates(): getCoordinationMatrix() hands out a cached matrix that is still
 * empty while a concurrent first call is pending.
 */
async function offsetOf(model: { getCoordinates(): Promise<number[]> }): Promise<THREE.Vector3> {
  const [x = 0, y = 0, z = 0] = await model.getCoordinates();
  return new THREE.Vector3(x, y, z);
}

export const CLASH_COLORS = { a: "#d92d20", b: "#2e90fa" };

/** Local ids of elements of the given IFC classes ("IfcWall" also matches IfcWallStandardCase). */
async function idsOfClasses(model: { getItemsOfCategories(c: RegExp[]): Promise<Record<string, number[]>> }, classes: string[]) {
  const res = await model.getItemsOfCategories(
    classes.map((c) => new RegExp(`^${c.trim().replace(/[^A-Za-z0-9_]/g, "")}(standardcase|elementedcase)?$`, "i")),
  );
  return Object.values(res).flat();
}

export const COMPARE_COLORS = { added: "#12b76a", changed: "#f79009", removed: "#d92d20", unchanged: "#9aa5b1" };
const COMPARE_STYLES = ["cmp-faded", "cmp-ghost", "cmp-added", "cmp-changed", "cmp-removed"];

export type FourDStatus = "not_started" | "in_progress" | "complete" | "late";
export const FOURD_COLORS: Record<FourDStatus, string> = {
  not_started: "#9aa5b1",
  in_progress: "#f79009",
  complete: "#12b76a",
  late: "#d92d20",
};
const FOURD_STYLES = ["4d-unlinked", "4d-not_started", "4d-in_progress", "4d-complete", "4d-late"];

async function localIds(model: { getLocalIdsByGuids(g: string[]): Promise<(number | null)[]> }, guids: string[]) {
  if (!guids.length) return [];
  return (await model.getLocalIdsByGuids(guids)).filter((x): x is number => x !== null && x !== undefined);
}

/**
 * All items of a model, for fading / ghosting. (getItemsIdsWithGeometry() did not settle
 * for small models in Fragments 3.4, so the plain local id list is used; items without
 * geometry are simply not drawn.)
 */
async function geometryIds(model: { getLocalIds(): Promise<number[]> }) {
  return model.getLocalIds();
}

function valueOf(attr: unknown): string | null {
  if (attr && typeof attr === "object" && "value" in attr) {
    const v = (attr as { value: unknown }).value;
    return v === null || v === undefined ? null : String(v);
  }
  return null;
}

type Data = Record<string, unknown>;

/** Turns That Open item data into readable groups: attributes, then one group per property set. */
function toGroups(data: Data): { name: string; rows: [string, string][] }[] {
  const groups: { name: string; rows: [string, string][] }[] = [];
  const attrs: [string, string][] = [];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) continue;
    const val = valueOf(v);
    if (val !== null && !k.startsWith("_")) attrs.push([k, val]);
  }
  const cat = valueOf(data._category);
  if (cat) attrs.unshift(["Sınıf", cat]);
  groups.push({ name: "Öznitelikler", rows: attrs });

  for (const rel of ["IsDefinedBy", "ContainedInStructure"]) {
    const list = data[rel];
    if (!Array.isArray(list)) continue;
    for (const set of list as Data[]) {
      const name = valueOf(set.Name) ?? valueOf(set._category) ?? rel;
      const rows: [string, string][] = [];
      const props = (set.HasProperties ?? set.Quantities ?? []) as Data[];
      if (Array.isArray(props) && props.length) {
        for (const p of props) {
          const pname = valueOf(p.Name);
          const pval =
            valueOf(p.NominalValue) ?? valueOf(p.LengthValue) ?? valueOf(p.AreaValue) ?? valueOf(p.VolumeValue) ?? valueOf(p.CountValue);
          if (pname) rows.push([pname, pval ?? "—"]);
        }
      } else if (rel === "ContainedInStructure") {
        rows.push(["Konum", name]);
      }
      if (rows.length) groups.push({ name: rel === "ContainedInStructure" ? "Konum" : name, rows });
    }
  }
  return groups;
}
