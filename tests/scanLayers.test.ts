import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { configureScanAssets, scanAssetUrl } from "../src/scan/assets";
import { DEFAULT_SCAN_IFC_OFFSET } from "../src/scan/constants";
import { ensureScanLights, pointOnTrackPath, railFocusBox } from "../src/scan/layers/ifcMesh";
import { createIotLayer, iotMarkerRadius, paintIotLayer } from "../src/scan/layers/iotLayer";
import { createSamplePointCloud } from "../src/scan/layers/pointCloud";
import { colorFromMeasurement, heatmapLegendStops, heatmapRange, valueToHeatColor } from "../src/scan/layers/trackHeatmap";
import type { IotSensor } from "../src/scan/types";

const sensor = (over: Partial<IotSensor> = {}): IotSensor => ({
  id: "s1",
  name: "A",
  groupName: "hat",
  channel: "cant",
  channelLabel: "Cant",
  unit: "mm",
  value: 1,
  status: "ok",
  position: [0, 1, 0],
  timestamps: [],
  series: [],
  ...over,
});

describe("scan assets and lights", () => {
  it("joins the configured public prefix", () => {
    configureScanAssets("/files/scans/");
    expect(scanAssetUrl("/preview.bin")).toBe("/files/scans/preview.bin");
    configureScanAssets();
    expect(scanAssetUrl("preview.bin")).toBe("/scans/preview.bin");
    expect(DEFAULT_SCAN_IFC_OFFSET[0]).toBeCloseTo(728.78);
  });

  it("adds scan lights once and focuses a rail box", () => {
    const scene = new THREE.Scene();
    ensureScanLights(scene);
    ensureScanLights(scene);
    expect(scene.getObjectByName("scan-key-light")).toBeTruthy();
    expect(scene.children.filter((c) => c.name.startsWith("scan-")).length).toBe(3);
    const root = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 20));
    root.name = "guzergah-sleepers";
    const box = railFocusBox(root);
    expect(box.isEmpty()).toBe(false);
  });
});

describe("point cloud / IoT layer / heatmap", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: () => undefined,
      beginPath: () => undefined,
      rect: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      fillText: () => undefined,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      font: "",
      textAlign: "center",
      textBaseline: "middle",
    } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => vi.restoreAllMocks());

  it("builds a smaller sample cloud and IoT markers", () => {
    const cloud = createSamplePointCloud(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 1, 4)), 200);
    expect(cloud).toBeInstanceOf(THREE.Points);
    expect((cloud.geometry.getAttribute("position") as THREE.BufferAttribute).count).toBe(200);
    expect(iotMarkerRadius(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 2, 10)))).toBeGreaterThan(0);
    const group = createIotLayer([sensor(), sensor({ id: "s2", status: "alarm", position: [2, 1, 2] })]);
    expect(group.children.length).toBeGreaterThan(0);
    paintIotLayer(group, [sensor({ status: "warn" })]);
  });

  it("maps values onto the heat ramp and expands a tight range", () => {
    const c = valueToHeatColor(0);
    expect(c.b).toBeCloseTo(1);
    const alarm = colorFromMeasurement(40, { IAL: { min: -10, max: 10 } }, -5, 5);
    expect(alarm.getHex()).toBe(0xff0000);
    expect(heatmapRange([])).toEqual({ min: -1, max: 1 });
    expect(heatmapRange([sensor({ value: 2 }), sensor({ value: 4 })]).min).toBeLessThan(2);
    expect(heatmapLegendStops().length).toBeGreaterThan(2);
  });

  it("interpolates a point on a track path", () => {
    const mid = pointOnTrackPath([new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)], 0.5);
    expect(mid.x).toBeCloseTo(5);
  });
});
