import * as THREE from "three";
import type { IotSensor, SensorStatus } from "../types.js";

const STATUS_COLOR: Record<SensorStatus, number> = {
  ok: 0x22c55e,
  warn: 0xf59e0b,
  alarm: 0xef4444,
};

function makeLabelTexture(text: string, hex: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
  ctx.beginPath();
  ctx.rect(8, 10, 240, 44);
  ctx.fill();
  ctx.strokeStyle = hex;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 20px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function iotMarkerRadius(box?: THREE.Box3 | null): number {
  if (!box || box.isEmpty()) return 0.35;
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 1);
  return THREE.MathUtils.clamp(span * 0.008, 0.35, 16);
}

export function createIotLayer(sensors: IotSensor[], markerRadius = 0.35): THREE.Group {
  const group = new THREE.Group();
  group.name = "iot-extension";
  const r = markerRadius;

  for (const sensor of sensors) {
    const color = STATUS_COLOR[sensor.status];
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(r, 18, 18),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.65,
        roughness: 0.35,
        metalness: 0.1,
      })
    );
    marker.position.set(...sensor.position);
    marker.name = sensor.id;
    marker.userData.sensorId = sensor.id;

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(r * 1.4, r * 2.05, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.copy(marker.position);
    halo.position.y -= r * 0.55;

    const valueText = sensor.value === null ? "—" : `${sensor.value}${sensor.unit}`;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeLabelTexture(`${sensor.name} · ${valueText}`, `#${color.toString(16).padStart(6, "0")}`),
        transparent: true,
        depthTest: false,
      })
    );
    label.position.copy(marker.position);
    label.position.y += r * 3.2;
    label.scale.set(r * 14, r * 3.5, 1);
    label.name = `${sensor.id}-label`;

    group.add(marker, halo, label);
  }

  return group;
}

export function paintIotLayer(group: THREE.Group, sensors: IotSensor[]) {
  for (const sensor of sensors) {
    const color = STATUS_COLOR[sensor.status];
    const marker = group.getObjectByName(sensor.id) as THREE.Mesh | undefined;
    if (marker && marker.material instanceof THREE.MeshStandardMaterial) {
      marker.material.color.setHex(color);
      marker.material.emissive.setHex(color);
    }
    const label = group.getObjectByName(`${sensor.id}-label`) as THREE.Sprite | undefined;
    if (label && label.material instanceof THREE.SpriteMaterial && label.material.map) {
      label.material.map.dispose();
      const valueText = sensor.value === null ? "—" : `${sensor.value}${sensor.unit}`;
      label.material.map = makeLabelTexture(
        `${sensor.name} · ${valueText}`,
        `#${color.toString(16).padStart(6, "0")}`
      );
    }
  }
}
