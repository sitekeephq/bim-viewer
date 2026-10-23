import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IoTDataView,
  configureIotApi,
  placeSensorsOnBox,
  placeSensorsOnPath,
} from "../src/scan/iot/dataView";
import type { IotSensorMeta } from "../src/scan/iot/dataView";

const payload = {
  sensors: {
    s1: { name: "A", groupName: "hat", km: 281, metre: 0, location: { x: 0, y: 0, z: 0 }, _trackOrder: 1 },
    s2: { name: "B", groupName: "hat", km: 281, metre: 25, location: { x: 0, y: 0, z: 0 }, _trackOrder: 2 },
  },
  channels: {
    cant: { name: "Cant", unit: "mm", limits: { AL: { min: -5, max: 5 } } },
  },
  samples: {
    timestamps: ["2024-01-01T00:00:00Z", "2025-01-01T00:00:00Z"],
    data: {
      s1: { cant: [1.2, 2.4] },
      s2: { cant: [null, 8] },
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  configureIotApi("http://localhost:8080/iot");
});

describe("IoTDataView", () => {
  it("loads the live API and maps sensors onto a box", async () => {
    configureIotApi("http://iot.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/sensors")) return new Response(JSON.stringify(payload.sensors));
        if (String(url).endsWith("/channels")) return new Response(JSON.stringify(payload.channels));
        if (String(url).endsWith("/samples")) return new Response(JSON.stringify(payload.samples));
        return new Response(null, { status: 404 });
      }),
    );
    const view = new IoTDataView();
    await view.init();
    expect(view.source).toBe("live");
    expect(view.getSample("s1", "cant", 2024)).toBe(1.2);
    const sensors = view.toSceneSensors({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 2, z: 10 } }, "cant", 2024, true);
    expect(sensors).toHaveLength(2);
    expect(sensors[0]?.status).toBe("ok");
    expect(sensors[1]?.name).toMatch(/281\+/);
  });

  it("falls back to the bundled sample when live fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) === "/iot-sample.json") return new Response(JSON.stringify(payload));
        return new Response(null, { status: 503 });
      }),
    );
    const view = new IoTDataView();
    await view.init();
    expect(view.source).toBe("sample");
  });
});

describe("sensor placement", () => {
  const sensors = new Map<string, IotSensorMeta>([
    ["a", { location: { x: 0, y: 0, z: 0 }, km: 1, metre: 0, _trackOrder: 1 }],
    ["b", { location: { x: 0, y: 0, z: 0 }, km: 1, metre: 25, _trackOrder: 2 }],
  ]);

  it("spaces sensors along a path and a box", () => {
    const onPath = placeSensorsOnPath(sensors, [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ]);
    expect(onPath.get("a")?.location.x).toBeCloseTo(0);
    expect(onPath.get("b")?.location.x).toBeCloseTo(10);
    const onBox = placeSensorsOnBox(sensors, { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 2, z: 8 } }, true);
    expect(onBox.get("a")?.location.x).toBe(0);
    expect(onBox.get("b")?.location.x).toBe(8);
  });
});
