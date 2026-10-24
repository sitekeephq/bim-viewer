import { describe, expect, it } from "vitest";
import { GuidCache, clearSim, costBin, paintCost, paintSim } from "../src/tools/sim-paint";
import { fakeModel, makeEngineStub } from "./helpers/engine-stub";

describe("GuidCache and sim painting", () => {
  it("resolves GlobalIds once per model", async () => {
    const model = fakeModel({ id: "arch", guids: { a: 1, b: 2 }, localIds: [1, 2, 3] });
    const cache = new GuidCache();
    await expect(cache.ids("arch", model, ["a", "missing", "b"])).resolves.toEqual([1, 2]);
    await expect(cache.ids("arch", model, ["a"])).resolves.toEqual([1]);
    await expect(cache.allIds("arch", model)).resolves.toEqual([1, 2, 3]);
  });

  it("paints a playback frame and a cost heat map", async () => {
    const model = fakeModel({ id: "arch", guids: { a: 1, b: 2, c: 3 }, localIds: [1, 2, 3] });
    const { engine } = makeEngineStub([model]);
    const cache = new GuidCache();
    await paintSim(engine, cache, {
      notStarted: ["c"],
      hideNotStarted: true,
      late: ["b"],
      inProgress: new Map([[0, ["a"]]]),
      fadeUnlinked: true,
      linked: new Set(["a", "b"]),
    });
    await paintCost(
      engine,
      cache,
      new Map([["arch", { elements: { a: 4, b: 16 }, max: 16 }]]),
    );
    await clearSim(engine);
  });

  it("bins cost on a square-root scale", () => {
    expect(costBin(0, 100)).toBe(0);
    expect(costBin(100, 100)).toBe(5);
    expect(costBin(25, 100)).toBe(3);
  });
});
