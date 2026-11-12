"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import type { HexColor, TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { useEffect, useRef, useState, useTransition } from "react";
import { validatePolygon } from "@/lib/geo";
import { LOGIN_MESSAGES } from "@/lib/login";
import type { Zone } from "@/lib/types";
import { archiveZone, saveZone } from "./zone-actions";

export const ZONE_COLORS = [
  "#e11d48",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
] as const satisfies readonly HexColor[];

export type ZoneEditorTarget = { kind: "new" } | { kind: "edit"; zone: Zone };

type Props = {
  map: MapLibreMap;
  target: ZoneEditorTarget;
  /** Called after a successful save (with the zone id), an archive, or Vazgeç (null). */
  onClose: (savedId: string | null) => void;
};

const POLYGON_MODE = "polygon";
const SELECT_MODE = "select";

function asHex(color: string): HexColor {
  return (/^#[0-9a-fA-F]{6}$/.test(color) ? color : ZONE_COLORS[5]) as HexColor;
}

function polygonStyles(color: HexColor) {
  return {
    fillColor: color,
    fillOpacity: 0.3,
    outlineColor: color,
    outlineWidth: 3,
    closingPointColor: "#ffffff" as HexColor,
    closingPointOutlineColor: color,
    closingPointWidth: 7,
    closingPointOutlineWidth: 3,
    coordinatePointColor: "#ffffff" as HexColor,
    coordinatePointOutlineColor: color,
    coordinatePointWidth: 5,
    coordinatePointOutlineWidth: 2,
  };
}

function selectStyles(color: HexColor) {
  return {
    selectedPolygonColor: color,
    selectedPolygonFillOpacity: 0.35,
    selectedPolygonOutlineColor: color,
    selectedPolygonOutlineWidth: 3,
    selectionPointColor: "#ffffff" as HexColor,
    selectionPointOutlineColor: color,
    selectionPointWidth: 7,
    selectionPointOutlineWidth: 3,
    midPointColor: color,
    midPointOutlineColor: "#ffffff" as HexColor,
    midPointWidth: 4,
    midPointOutlineWidth: 2,
  };
}

/**
 * Runs a server action and turns a rejection (network drop, timeout, session check failed) into an
 * ordinary `{ ok: false }` result. Uncaught, it would reach the error boundary, which replaces the
 * board and loses the drawing and the form.
 */
async function callAction<R extends { ok: boolean }>(action: () => Promise<R>): Promise<R | { ok: false; error: string }> {
  try {
    return await action();
  } catch (e) {
    console.error("zone action failed", e);
    return { ok: false, error: LOGIN_MESSAGES.CONNECTION };
  }
}

/**
 * Side-panel form plus the terra-draw session for one zone. terra-draw lives exactly as long as
 * this component: it starts on mount and `stop()` (which also removes its map layers) on unmount.
 *
 * - new:  polygon mode → on finish, switch to select mode with the new feature selected (its
 *         vertices stay draggable) and show the name/colour/note form.
 * - edit: the zone's polygon is added to the terra-draw store under the zone id and selected.
 *
 * On a failed save the feature stays in the store, so the drawing stays on screen.
 */
export function ZoneEditor({ map, target, onClose }: Props) {
  const editing = target.kind === "edit" ? target.zone : null;
  const drawRef = useRef<TerraDraw | null>(null);
  const [featureId, setFeatureId] = useState<string | null>(editing?.id ?? null);
  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState<HexColor>(asHex(editing?.color ?? ZONE_COLORS[5]));
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, startTransition] = useTransition();
  const colorRef = useRef(color);

  // Start terra-draw for this editing session.
  useEffect(() => {
    let cancelled = false;
    let draw: TerraDraw | null = null;

    Promise.all([import("terra-draw"), import("terra-draw-maplibre-gl-adapter")]).then(
      ([{ TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode }, { TerraDrawMapLibreGLAdapter }]) => {
        if (cancelled) return;
        const c = colorRef.current;
        draw = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 9 }),
          modes: [
            new TerraDrawPolygonMode({ styles: polygonStyles(c) }),
            new TerraDrawSelectMode({
              styles: selectStyles(c),
              allowManualDeselection: false,
              // No keyboard delete/rotate/scale: the only way to remove a zone is "Arşivle".
              keyEvents: { deselect: null, delete: null, rotate: null, scale: null },
              flags: {
                [POLYGON_MODE]: {
                  feature: {
                    draggable: false,
                    // The server (ST_IsValid) is the authority on shape validity.
                    selfIntersectable: true,
                    coordinates: { draggable: true, midpoints: true, deletable: true },
                  },
                },
              },
            }),
          ],
        });
        draw.start();
        drawRef.current = draw;

        if (editing) {
          const result = draw.addFeatures([
            { type: "Feature", id: editing.id, geometry: editing.geojson, properties: { mode: POLYGON_MODE } },
          ]);
          if (!result[0]?.valid) {
            console.error("terra-draw rejected zone geometry", result[0]?.reason);
            setError("Bu bölgenin şekli düzenleyiciye yüklenemedi.");
            return;
          }
          draw.setMode(SELECT_MODE);
          draw.selectFeature(editing.id);
        } else {
          const d = draw;
          d.setMode(POLYGON_MODE);
          d.on("finish", (id, context) => {
            if (context.mode !== POLYGON_MODE) return;
            setFeatureId(String(id));
            d.setMode(SELECT_MODE);
            d.selectFeature(id);
          });
        }
      },
    );

    return () => {
      cancelled = true;
      drawRef.current = null;
      draw?.stop();
    };
    // One terra-draw session per mount; the parent remounts (key) for a different target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Recolour the in-progress drawing when the colour changes.
  useEffect(() => {
    colorRef.current = color;
    const draw = drawRef.current;
    if (!draw) return;
    draw.updateModeOptions<typeof TerraDrawPolygonMode>(POLYGON_MODE, {
      styles: polygonStyles(color),
    });
    draw.updateModeOptions<typeof TerraDrawSelectMode>(SELECT_MODE, {
      styles: selectStyles(color),
    });
  }, [color]);

  function handleSave() {
    setError(null);
    const draw = drawRef.current;
    const feature = featureId && draw ? draw.getSnapshotFeature(featureId) : undefined;
    if (!feature || feature.geometry.type !== "Polygon") {
      setError("Önce haritada bölgeyi çizin.");
      return;
    }
    const polygon = validatePolygon(feature.geometry);
    if (!polygon.ok) {
      setError(polygon.error);
      return;
    }
    startTransition(async () => {
      const result = await callAction(() =>
        saveZone({
          id: editing?.id ?? null,
          name,
          color,
          note: note.trim() || null,
          geojson: polygon.polygon,
        }),
      );
      if (result.ok) onClose(result.id);
      else setError(result.error);
    });
  }

  function handleArchive() {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      const result = await callAction(() => archiveZone(editing.id));
      if (result.ok) onClose(null);
      else {
        setConfirmArchive(false);
        setError(result.error);
      }
    });
  }

  const title = editing ? "Bölgeyi düzenle" : "Yeni bölge";

  if (!editing && !featureId) {
    return (
      <section aria-label={title} className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        <p className="text-sm text-zinc-600">
          Haritaya tıklayarak köşeleri ekleyin. Bitirmek için ilk noktaya ya da son noktaya tekrar
          tıklayın. Esc ile çizime baştan başlarsınız.
        </p>
        <button
          type="button"
          onClick={() => onClose(null)}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
        >
          Vazgeç
        </button>
      </section>
    );
  }

  const assigned = editing?.active_count ?? 0;

  return (
    <section aria-label={title} className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Köşeleri sürükleyerek şekli değiştirebilirsiniz; kenar ortasındaki noktayı sürüklemek yeni
          köşe ekler.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <label className="block">
          <span className="text-sm font-medium text-zinc-800">Bölge adı</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoFocus
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
          />
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-zinc-800">Renk</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ZONE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Renk ${c}`}
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={`h-8 w-8 rounded-full ring-offset-2 ${color === c ? "ring-2 ring-zinc-900" : ""}`}
              />
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-sm font-medium text-zinc-800">Not</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="İsteğe bağlı"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
          />
        </label>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onClose(null)}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
          >
            Vazgeç
          </button>
        </div>
      </form>

      {editing && (
        <div className="border-t border-zinc-200 pt-4">
          {confirmArchive ? (
            <div role="alertdialog" aria-label="Arşivleme onayı" className="space-y-3 rounded-lg bg-amber-50 p-3">
              <p className="text-sm text-amber-900">
                “{editing.name}” arşivlenecek.
                {assigned > 0 && ` ${assigned} kişinin ataması kaldırılacak.`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={handleArchive}
                  className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
                >
                  Evet, arşivle
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirmArchive(false)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 disabled:opacity-60"
                >
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmArchive(true)}
              className="text-sm font-medium text-red-700 hover:underline disabled:opacity-60"
            >
              Arşivle
            </button>
          )}
        </div>
      )}
    </section>
  );
}
