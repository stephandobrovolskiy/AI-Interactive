/**
 * Save slots and discovered-map memory in localStorage.
 * No backend: everything lives in the viewer's browser.
 */

export interface SaveSlot {
  slot: number;
  nodeId: string;
  nodeTitle: string;
  savedAt: number;
  /** Nodes visited on this run, in order. */
  path: string[];
}

export const SLOT_COUNT = 3;

const SLOTS_KEY = "interactive-film:slots";
const SEEN_KEY = "interactive-film:seen";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): the game keeps running without saves.
  }
}

export function readSlots(): Array<SaveSlot | null> {
  const stored = read<Array<SaveSlot | null>>(SLOTS_KEY, []);
  const slots: Array<SaveSlot | null> = [];
  for (let i = 0; i < SLOT_COUNT; i++) slots.push(stored[i] ?? null);
  return slots;
}

export function writeSlot(slot: number, data: Omit<SaveSlot, "slot" | "savedAt">): SaveSlot {
  const slots = readSlots();
  const entry: SaveSlot = { ...data, slot, savedAt: Date.now() };
  slots[slot] = entry;
  write(SLOTS_KEY, slots);
  return entry;
}

/** The most recently written slot, if any. */
export function latestSlot(): SaveSlot | null {
  let best: SaveSlot | null = null;
  for (const s of readSlots()) {
    if (s && (!best || s.savedAt > best.savedAt)) best = s;
  }
  return best;
}

/** Nodes the viewer has ever reached. This is what the map lifts the fog from. */
export function readSeen(): Set<string> {
  return new Set(read<string[]>(SEEN_KEY, []));
}

export function markSeen(ids: Iterable<string>): Set<string> {
  const seen = readSeen();
  for (const id of ids) seen.add(id);
  write(SEEN_KEY, [...seen]);
  return seen;
}

export function formatSavedAt(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
