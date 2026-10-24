import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SectionTool } from "../src/tools/sections";
import { fakeModel, makeEngineStub } from "./helpers/engine-stub";

describe("SectionTool", () => {
  it("adds planes, disables them and round-trips state without the box faces", () => {
    const { engine } = makeEngineStub([fakeModel({ id: "arch" })]);
    const tool = new SectionTool(engine);
    const id = tool.addPlane([0, 1, 0], [0, 2, 0]);
    expect(tool.planes).toEqual([{ id, kind: "plane", no: 1, enabled: true }]);
    tool.setEnabled(id, false);
    expect(tool.planes[0]?.enabled).toBe(false);
    const saved = tool.state();
    expect(saved.planes).toHaveLength(1);
    expect(saved.box).toBeNull();
    tool.apply({
      planes: [{ origin: [1, 0, 0], normal: [1, 0, 0] }],
      box: { min: [-2, 0, -2], max: [2, 3, 2] },
    });
    expect(tool.planes.filter((p) => p.kind === "plane")).toHaveLength(1);
    expect(tool.box?.min.toArray()).toEqual([-2, 0, -2]);
    expect(tool.planes.filter((p) => p.kind === "box")).toHaveLength(6);
    tool.dispose();
  });

  it("builds six clip faces for a section box and clears them together", () => {
    const { engine } = makeEngineStub([
      fakeModel({ id: "arch", box: new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 3, 4)) }),
      fakeModel({ id: "mep", box: new THREE.Box3(new THREE.Vector3(2, 0, 2), new THREE.Vector3(8, 5, 8)) }),
    ]);
    const tool = new SectionTool(engine);
    const union = tool.modelBox();
    expect(union.min.toArray()).toEqual([-4, 0, -4]);
    expect(union.max.toArray()).toEqual([8, 5, 8]);
    tool.setBox(union);
    expect(tool.box).toBeTruthy();
    expect(tool.planes.filter((p) => p.kind === "box")).toHaveLength(6);
    expect(tool.state().box).toEqual({ min: [-4, 0, -4], max: [8, 5, 8] });
    tool.setBox(null);
    expect(tool.box).toBeNull();
    expect(tool.planes).toEqual([]);
  });

  it("adds an invisible plan cut and reports it separately from free planes", () => {
    const { engine } = makeEngineStub([fakeModel({ id: "arch" })]);
    const tool = new SectionTool(engine);
    tool.setPlanCut(2.4);
    expect(tool.hasPlanCut).toBe(true);
    expect(tool.planes.some((p) => p.kind === "plan")).toBe(true);
    tool.setPlanCut(null);
    expect(tool.hasPlanCut).toBe(false);
  });

  it("does not add a plane when the raycast misses", async () => {
    const { engine } = makeEngineStub([fakeModel({ id: "arch" })]);
    const tool = new SectionTool(engine);
    await expect(tool.addPlaneAtPointer(10, 10)).resolves.toBe(false);
    expect(tool.planes).toEqual([]);
  });
});
