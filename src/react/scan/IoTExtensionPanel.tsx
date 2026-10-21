import React from "react";
import {
  IoTDataView,
  formatRailChainageLabel,
  sensorsUseTrackChainage,
  trackChainageMetres,
} from "../../scan/iot/dataView.js";
import type { IotSensor } from "../../scan/types.js";
import type { IotChannel, LimitBand } from "../../scan/iot/dataView.js";
import { heatmapLegendStops, heatmapRange, type HeatmapFilter } from "../../scan/layers/trackHeatmap.js";

export type IotPanelView = "list" | "detail" | "heatmap" | "range";

interface Props {
  view: IotPanelView;
  sensors: IotSensor[];
  selectedId: string | null;
  dataView: IoTDataView | null;
  channelId: string;
  year: number;
  bimOn: boolean;
  pointCloudOn: boolean;
  heatmapFilter: HeatmapFilter;
  onChannel: (id: string) => void;
  onYear: (year: number) => void;
  onToggleBim: (value: boolean) => void;
  onTogglePointCloud: (value: boolean) => void;
  onSelect: (id: string) => void;
  onOpenDetail: () => void;
  onHeatmapFilter: (filter: HeatmapFilter) => void;
  onClose: () => void;
}

const CHANNEL_ORDER = [
  "gauge",
  "cant",
  "alignment_r",
  "alignment_l",
  "long_level_r",
  "long_level_l",
  "twist",
];

function sortChannelEntries(channels: Map<string, IotChannel>) {
  return [...channels.entries()].sort(([a], [b]) => {
    const ia = CHANNEL_ORDER.indexOf(a);
    const ib = CHANNEL_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

const VIEW_TITLES: Record<IotPanelView, string> = {
  list: "IoT Sensors",
  detail: "Sensor Detail",
  heatmap: "IoT Heatmaps",
  range: "Km Aralığı Grafiği",
};

const statusColor = {
  ok: "#22c55e",
  warn: "#eab308",
  alarm: "#ef4444",
};

function finiteRange(values: Array<number | null>, limits?: IotSensor["limits"]) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const limitValues = limits
    ? Object.values(limits).flatMap((limit) => limit ? [limit.min, limit.max] : [])
    : [];
  const all = [...finite, ...limitValues];
  const min = all.length ? Math.min(...all) : -1;
  const max = all.length ? Math.max(...all) : 1;
  const pad = Math.max((max - min) * 0.12, 0.5);
  return { min: min - pad, max: max + pad };
}

function LineChart({
  values,
  labels,
  limits,
  color = "#38bdf8",
}: {
  values: Array<number | null>;
  labels: string[];
  limits?: { AL?: LimitBand; IL?: LimitBand; IAL?: LimitBand };
  color?: string;
}) {
  const width = 440;
  const height = 174;
  const left = 38;
  const right = 12;
  const top = 12;
  const bottom = 30;
  const range = finiteRange(values, limits);
  const x = (index: number) => left + (index / Math.max(values.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + ((range.max - value) / (range.max - range.min || 1)) * (height - top - bottom);
  const path = values
    .map((value, index) => value === null ? null : `${index === 0 || values[index - 1] === null ? "M" : "L"} ${x(index)} ${y(value)}`)
    .filter(Boolean)
    .join(" ");
  const bands = [
    { key: "AL", color: "#eab308" },
    { key: "IL", color: "#f97316" },
    { key: "IAL", color: "#ef4444" },
  ] as const;
  const labelIndexes = labels.length <= 8
    ? labels.map((_, index) => index)
    : [0, Math.floor((labels.length - 1) / 2), labels.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" style={{ width: "100%", display: "block" }}>
      {[0, 0.5, 1].map((ratio) => {
        const value = range.max - (range.max - range.min) * ratio;
        return (
          <g key={ratio}>
            <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="var(--text-muted)" opacity="0.18" />
            <text x={left - 5} y={y(value) + 3} textAnchor="end" fill="var(--text-muted)" fontSize="9">
              {value.toFixed(1)}
            </text>
          </g>
        );
      })}
      {bands.map(({ key, color: bandColor }) => {
        const limit = limits?.[key];
        if (!limit) return null;
        return (
          <g key={key}>
            {[limit.min, limit.max].map((value) => (
              <line
                key={value}
                x1={left}
                x2={width - right}
                y1={y(value)}
                y2={y(value)}
                stroke={bandColor}
                strokeDasharray="6 3"
                strokeWidth="1"
              />
            ))}
          </g>
        );
      })}
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {values.map((value, index) => value === null ? null : (
        <circle key={index} cx={x(index)} cy={y(value)} r="3" fill={color}>
          <title>{labels[index]}: {value}</title>
        </circle>
      ))}
      {labelIndexes.map((index) => (
        <text key={index} x={x(index)} y={height - 7} textAnchor="middle" fill="var(--text-muted)" fontSize="9">
          {labels[index]}
        </text>
      ))}
    </svg>
  );
}

function PanelShell({
  view,
  children,
  onClose,
}: {
  view: IotPanelView;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const resizeHandleRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = React.useRef<{ right: number; startX: number; startWidth: number; top: number } | null>(null);
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
  const [width, setWidth] = React.useState(view === "range" ? 540 : view === "detail" ? 420 : 350);
  const defaultPlacement: Record<IotPanelView, React.CSSProperties> = {
    list: { top: 70, left: 270 },
    detail: { top: 70, right: 18 },
    heatmap: { top: 96, left: 640 },
    range: { top: 130, left: "calc(50% - 270px)" },
  };

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const keepInsidePanel = (event: Event) => event.stopPropagation();
    const events: Array<keyof HTMLElementEventMap> = ["wheel", "touchmove"];
    events.forEach((name) => panel.addEventListener(name, keepInsidePanel));
    return () => events.forEach((name) => panel.removeEventListener(name, keepInsidePanel));
  }, []);

  React.useEffect(() => {
    const handle = resizeHandleRef.current;
    if (!handle) return;
    const startResize = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      resizeRef.current = {
        right: rect.right,
        startX: event.clientX,
        startWidth: rect.width,
        top: rect.top,
      };
    };
    handle.addEventListener("pointerdown", startResize);
    return () => handle.removeEventListener("pointerdown", startResize);
  }, []);

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (resize) {
        const maxWidth = Math.min(760, window.innerWidth - 24);
        const nextWidth = Math.max(300, Math.min(maxWidth, resize.startWidth + resize.startX - event.clientX));
        setWidth(nextWidth);
        setPosition({ left: resize.right - nextWidth, top: resize.top });
        return;
      }
      if (!dragRef.current) return;
      setPosition({
        left: Math.max(0, event.clientX - dragRef.current.dx),
        top: Math.max(0, event.clientY - dragRef.current.dy),
      });
    };
    const up = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      data-iot-panel="true"
      style={{
        position: "fixed",
        ...defaultPlacement[view],
        top: position?.top ?? defaultPlacement[view].top,
        left: position?.left ?? defaultPlacement[view].left,
        right: position ? undefined : defaultPlacement[view].right,
        width,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: "calc(100vh - 100px)",
        zIndex: 2200,
        overflow: "hidden",
        border: "1px solid color-mix(in srgb, var(--text-muted) 45%, transparent)",
        borderRadius: 12,
        background: "color-mix(in srgb, var(--background-100) 94%, transparent)",
        color: "var(--text)",
        boxShadow: "0 22px 55px rgba(0,0,0,.28)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        ref={resizeHandleRef}
        role="separator"
        aria-orientation="vertical"
        title="Panel genişliğini ayarla"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 2,
          width: 8,
          cursor: "ew-resize",
          touchAction: "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "50%",
            left: 1,
            width: 3,
            height: 34,
            transform: "translateY(-50%)",
            borderRadius: 4,
            background: "color-mix(in srgb, var(--text-muted) 45%, transparent)",
          }}
        />
      </div>
      <div
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const rect = panelRef.current?.getBoundingClientRect();
          if (!rect) return;
          dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid color-mix(in srgb, var(--text-muted) 28%, transparent)",
          cursor: "grab",
          fontWeight: 650,
        }}
      >
        <span>{VIEW_TITLES[view]}</span>
        <button type="button" onClick={onClose} aria-label="Paneli kapat" style={iconButtonStyle}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div
        style={{
          maxHeight: "calc(100vh - 154px)",
          overflowX: "hidden",
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
          padding: 12,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 7,
  border: "1px solid color-mix(in srgb, var(--text-muted) 40%, transparent)",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
  boxSizing: "border-box",
  minWidth: 28,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
  flexShrink: 0,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 4,
  padding: "7px 8px",
  borderRadius: 7,
  border: "1px solid color-mix(in srgb, var(--text-muted) 40%, transparent)",
  background: "var(--background-200)",
  color: "var(--text)",
};

function SensorListView(props: Props) {
  const groups = props.sensors.reduce<Record<string, IotSensor[]>>((result, sensor) => {
    (result[`Km ${sensor.groupName}`] ||= []).push(sensor);
    return result;
  }, {});
  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        Bir ölçüm noktasına tıklayın; konuma odaklanıp detay grafiklerini açar.
      </p>
      {Object.entries(groups).map(([group, sensors]) => (
        <section key={group} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>{group}</div>
          {sensors.map((sensor) => (
            <button
              key={sensor.id}
              type="button"
              onClick={() => {
                props.onSelect(sensor.id);
                props.onOpenDetail();
              }}
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "9px 10px",
                marginBottom: 5,
                borderRadius: 8,
                border: sensor.id === props.selectedId ? "1px solid var(--primary)" : "1px solid transparent",
                background: "var(--background-200)",
                color: "var(--text)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span>
                <strong style={{ display: "block", fontSize: 13 }}>{sensor.name}</strong>
                <small style={{ color: "var(--text-muted)" }}>
                  {sensor.channelLabel} · {sensor.value === null ? "—" : `${sensor.value} ${sensor.unit}`}
                </small>
              </span>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: statusColor[sensor.status] }} />
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function SensorDetailView(props: Props) {
  const sensorId = props.selectedId || props.sensors[0]?.id;
  const sensorMeta = sensorId ? props.dataView?.sensors.get(sensorId) : null;
  const timestamps = props.dataView?.samples?.timestamps || [];
  if (!sensorId || !props.dataView) {
    return <p style={{ color: "var(--text-muted)" }}>Grafik için önce bir sensör seçin.</p>;
  }
  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <strong>{sensorMeta?.name || sensorId}</strong>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tüm kanal geçmişi · AL / IL / IAL sınırları</div>
      </div>
      {sortChannelEntries(props.dataView.channels).map(([channelId, channel]) => {
        const values = props.dataView?.samples?.data?.[sensorId]?.[channelId] || [];
        return (
          <section key={channelId} style={{ padding: "9px 0", borderTop: "1px solid color-mix(in srgb, var(--text-muted) 24%, transparent)" }}>
            <div style={{ fontSize: 12, fontWeight: 650 }}>{channel.name} ({channel.unit})</div>
            {values.length ? (
              <LineChart
                values={values}
                labels={timestamps.map((timestamp) => timestamp.toLocaleDateString("tr-TR", { year: "numeric", month: "short" }))}
                limits={channel.limits}
              />
            ) : (
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "6px 0 0" }}>Bu kanal için örnek veri yok.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function HeatmapView(props: Props) {
  const channels = props.dataView ? sortChannelEntries(props.dataView.channels) : [];
  const years = Array.from(new Set(props.dataView?.samples?.timestamps.map((timestamp) => timestamp.getFullYear()) || [props.year]));
  const range = heatmapRange(props.sensors);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Kanal
          <select value={props.channelId} onChange={(event) => props.onChannel(event.target.value)} style={selectStyle}>
            {channels.map(([id, channel]) => <option key={id} value={id}>{channel.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Yıl
          <select value={props.year} onChange={(event) => props.onYear(Number(event.target.value))} style={selectStyle}>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: "block", marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>Eleman filtresi
        <select value={props.heatmapFilter} onChange={(event) => props.onHeatmapFilter(event.target.value as HeatmapFilter)} style={selectStyle}>
          <option value="sleepers">Traversler</option>
          <option value="rails">Raylar</option>
          <option value="all">Tüm Elemanlar</option>
        </select>
      </label>
      <div style={{ marginTop: 14 }}>
        <div style={{
          height: 20,
          borderRadius: 5,
          background: `linear-gradient(90deg, ${heatmapLegendStops().join(", ")})`,
        }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--text-muted)" }}>
          <span>{range.min.toFixed(2)}</span><span>{range.max.toFixed(2)}</span>
        </div>
      </div>
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid color-mix(in srgb, var(--text-muted) 24%, transparent)" }}>
        <label style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span>BIM / güzergah</span>
          <input type="checkbox" checked={props.bimOn} onChange={(event) => props.onToggleBim(event.target.checked)} />
        </label>
        <label style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Arazi / point cloud (LAS)</span>
          <input type="checkbox" checked={props.pointCloudOn} onChange={(event) => props.onTogglePointCloud(event.target.checked)} />
        </label>
      </div>
    </div>
  );
}

function RangeChartView(props: Props) {
  const useTrackChainage = sensorsUseTrackChainage(props.sensors);
  const baseKm = props.sensors.reduce((min, sensor) => Math.min(min, sensor.km ?? min), props.sensors[0]?.km ?? 0);
  const chainageOf = (sensor: IotSensor) =>
    useTrackChainage && sensor.trackOrder != null
      ? trackChainageMetres(sensor.trackOrder)
      : (sensor.km || 0) * 1000 + (sensor.metre || 0);
  const labelOf = (sensor: IotSensor) =>
    useTrackChainage && sensor.trackOrder != null
      ? formatRailChainageLabel(baseKm, sensor.trackOrder)
      : sensor.name;
  const positions = props.sensors.map(chainageOf);
  const minPosition = positions.length ? Math.min(...positions) : 0;
  const maxPosition = positions.length ? Math.max(...positions) : 0;
  const [from, setFrom] = React.useState(minPosition);
  const [to, setTo] = React.useState(maxPosition);
  const channels = props.dataView ? sortChannelEntries(props.dataView.channels) : [];
  const years = Array.from(new Set(props.dataView?.samples?.timestamps.map((timestamp) => timestamp.getFullYear()) || [props.year]));
  const points = props.sensors
    .filter((sensor) => {
      const position = chainageOf(sensor);
      return position >= from && position <= to;
    })
    .sort((a, b) => chainageOf(a) - chainageOf(b));
  const channel = props.dataView?.channels.get(props.channelId);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {useTrackChainage ? "Başlangıç (hat m)" : "Başlangıç (metre)"}
          <input type="number" value={from} onChange={(event) => setFrom(Number(event.target.value))} style={selectStyle} />
        </label>
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {useTrackChainage ? "Bitiş (hat m)" : "Bitiş (metre)"}
          <input type="number" value={to} onChange={(event) => setTo(Number(event.target.value))} style={selectStyle} />
        </label>
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Kanal
          <select value={props.channelId} onChange={(event) => props.onChannel(event.target.value)} style={selectStyle}>
            {channels.map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Yıl
          <select value={props.year} onChange={(event) => props.onYear(Number(event.target.value))} style={selectStyle}>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
      </div>
      <div style={{ marginTop: 14, padding: 8, borderRadius: 8, background: "var(--background-200)" }}>
        <div style={{ fontSize: 12, fontWeight: 650 }}>
          {channel?.name || props.channelId} ({channel?.unit || ""}) · {props.year}
        </div>
        <LineChart
          values={points.map((sensor) => sensor.value)}
          labels={points.map(labelOf)}
          limits={channel?.limits}
        />
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{points.length} ölçüm noktası</div>
      </div>
    </div>
  );
}

export function IoTExtensionPanel(props: Props) {
  return (
    <PanelShell view={props.view} onClose={props.onClose}>
      {props.view === "list" && <SensorListView {...props} />}
      {props.view === "detail" && <SensorDetailView {...props} />}
      {props.view === "heatmap" && <HeatmapView {...props} />}
      {props.view === "range" && <RangeChartView {...props} />}
    </PanelShell>
  );
}
