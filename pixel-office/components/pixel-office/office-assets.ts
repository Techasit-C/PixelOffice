// Registry for the real isometric office tile art in
// public/office-assets/tiles/ (see public/office-assets/LICENSES.md for
// provenance — license needs confirmation). Each tile is a 64x64 RGBA PNG
// with real alpha transparency (verified against the source pack), meant to
// be displayed at an integer-ish scale with nearest-neighbor filtering so the
// pixel art stays crisp — see `imageRendering: "pixelated"` at every call
// site that renders one of these.
//
// Only a curated subset of the 64-tile atlas is copied in; this file is the
// single source of truth for "which tile means what" so OfficeScene never
// hardcodes a `tile-NN.png` path directly.
export const OFFICE_ASSET_BASE = "/office-assets/tiles";

export type OfficeTileId =
  | "floorMarble"
  | "floorHerringbone"
  | "floorPlank"
  | "windowStraight"
  | "windowCorner"
  | "wallPanel"
  | "doorWood"
  | "doorGlass"
  | "windowCity"
  | "deskSingleMonitor"
  | "deskDualMonitor"
  | "deskTripleMonitor"
  | "receptionDesk"
  | "meetingTableRound"
  | "conferenceTableLong"
  | "serverRackSingle"
  | "serverRackDouble"
  | "bookshelf"
  | "filingCabinet"
  | "plantLarge"
  | "plantWindow"
  | "rugSquare"
  | "rugRound";

export const OFFICE_TILES: Record<OfficeTileId, string> = {
  floorMarble: `${OFFICE_ASSET_BASE}/tile-00.png`,
  floorHerringbone: `${OFFICE_ASSET_BASE}/tile-03.png`,
  floorPlank: `${OFFICE_ASSET_BASE}/tile-08.png`,
  windowStraight: `${OFFICE_ASSET_BASE}/tile-16.png`,
  windowCorner: `${OFFICE_ASSET_BASE}/tile-17.png`,
  wallPanel: `${OFFICE_ASSET_BASE}/tile-24.png`,
  doorWood: `${OFFICE_ASSET_BASE}/tile-32.png`,
  doorGlass: `${OFFICE_ASSET_BASE}/tile-34.png`,
  windowCity: `${OFFICE_ASSET_BASE}/tile-36.png`,
  deskSingleMonitor: `${OFFICE_ASSET_BASE}/tile-40.png`,
  deskDualMonitor: `${OFFICE_ASSET_BASE}/tile-42.png`,
  deskTripleMonitor: `${OFFICE_ASSET_BASE}/tile-44.png`,
  receptionDesk: `${OFFICE_ASSET_BASE}/tile-48.png`,
  meetingTableRound: `${OFFICE_ASSET_BASE}/tile-51.png`,
  conferenceTableLong: `${OFFICE_ASSET_BASE}/tile-52.png`,
  serverRackSingle: `${OFFICE_ASSET_BASE}/tile-56.png`,
  serverRackDouble: `${OFFICE_ASSET_BASE}/tile-57.png`,
  bookshelf: `${OFFICE_ASSET_BASE}/tile-58.png`,
  filingCabinet: `${OFFICE_ASSET_BASE}/tile-59.png`,
  plantLarge: `${OFFICE_ASSET_BASE}/tile-60.png`,
  plantWindow: `${OFFICE_ASSET_BASE}/tile-61.png`,
  rugSquare: `${OFFICE_ASSET_BASE}/tile-62.png`,
  rugRound: `${OFFICE_ASSET_BASE}/tile-63.png`,
};

/** Desk tile + approximate on-tile screen position, keyed by monitor count. */
export interface DeskTileSpec {
  tile: OfficeTileId;
  /** Percent-of-tile position for the CSS screen-glow overlay (approximate). */
  screen: { left: number; top: number; width: number; height: number };
}

export const DESK_TILE_BY_MONITOR_COUNT: Record<1 | 2 | 3, DeskTileSpec> = {
  1: {
    tile: "deskSingleMonitor",
    screen: { left: 28, top: 24, width: 30, height: 18 },
  },
  2: {
    tile: "deskDualMonitor",
    screen: { left: 22, top: 22, width: 40, height: 18 },
  },
  3: {
    tile: "deskTripleMonitor",
    screen: { left: 18, top: 18, width: 55, height: 20 },
  },
};
