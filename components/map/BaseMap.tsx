"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, type ReactNode } from "react";
import { ANKARA_CENTER, ANKARA_ZOOM, basemapStyle, showBasemap, type BasemapId } from "./basemaps";

type Props = {
  basemap: BasemapId;
  /** Called once, after the first style load. Add sources/layers here. */
  onReady: (map: MapLibreMap) => void;
  /**
   * Called if the style is ever reloaded (a later `style.load`), so overlay layers can be
   * re-added. Switching basemaps does not reload the style, so this does not fire for that.
   */
  onStyleReload?: (map: MapLibreMap) => void;
  className?: string;
  /** Overlay content positioned over the map (e.g. the basemap toggle). */
  children?: ReactNode;
};

/**
 * MapLibre map centred on Ankara. maplibre-gl is imported dynamically inside an effect so it is
 * only ever loaded in the browser.
 */
export function BaseMap({ basemap, onReady, onStyleReload, className, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const callbacks = useRef({ onReady, onStyleReload });
  const initialBasemap = useRef(basemap);

  useEffect(() => {
    callbacks.current = { onReady, onStyleReload };
  });

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    import("maplibre-gl").then(({ Map, NavigationControl, setWorkerUrl }) => {
      if (cancelled || !containerRef.current) return;
      // MapLibre 6 finds its worker next to its own module URL, which a bundler breaks. This
      // `new URL(..., import.meta.url)` makes the bundler emit the worker file as a static asset.
      setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
      map = new Map({
        container: containerRef.current,
        style: basemapStyle(initialBasemap.current),
        center: ANKARA_CENTER,
        zoom: ANKARA_ZOOM,
        attributionControl: { compact: true },
        dragRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;
      // Development-only handle for the browser tests in tests/e2e (query rendered features).
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __sahaMap?: MapLibreMap }).__sahaMap = map;
      }

      const m = map;
      m.on("style.load", () => {
        if (!loadedRef.current) {
          loadedRef.current = true;
          callbacks.current.onReady(m);
        } else {
          callbacks.current.onStyleReload?.(m);
        }
      });
    });

    return () => {
      cancelled = true;
      loadedRef.current = false;
      mapRef.current = null;
      map?.remove();
    };
  }, []);

  useEffect(() => {
    initialBasemap.current = basemap;
    const map = mapRef.current;
    if (map && loadedRef.current) showBasemap(map, basemap);
  }, [basemap]);

  return (
    <div className={`relative ${className ?? ""}`}>
      {/* maplibre-gl.css makes the container `position: relative`, so it sizes via a wrapper. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      {children}
    </div>
  );
}
