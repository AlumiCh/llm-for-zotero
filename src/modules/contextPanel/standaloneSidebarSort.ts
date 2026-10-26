/**
 * Order of the window sidebar's "Conversations" list, picked from the sort
 * menu on its heading, and the short date a row may show at its end.
 */

export type StandaloneSidebarSortOrder = "recent" | "created" | "title";

export const STANDALONE_SIDEBAR_SORT_ORDERS: readonly StandaloneSidebarSortOrder[] =
  ["recent", "created", "title"];

export const DEFAULT_STANDALONE_SIDEBAR_SORT_ORDER: StandaloneSidebarSortOrder =
  "recent";

export function parseStandaloneSidebarSortOrder(
  value: unknown,
): StandaloneSidebarSortOrder {
  return STANDALONE_SIDEBAR_SORT_ORDERS.includes(
    value as StandaloneSidebarSortOrder,
  )
    ? (value as StandaloneSidebarSortOrder)
    : DEFAULT_STANDALONE_SIDEBAR_SORT_ORDER;
}

/** Short name on the heading's sort button. */
export function getStandaloneSidebarSortButtonLabel(
  order: StandaloneSidebarSortOrder,
): string {
  if (order === "created") return "Created";
  if (order === "title") return "A–Z";
  return "Recent";
}

/** Full name in the sort menu. */
export function getStandaloneSidebarSortMenuLabel(
  order: StandaloneSidebarSortOrder,
): string {
  if (order === "created") return "Date created";
  if (order === "title") return "Title (A–Z)";
  return "Recent activity";
}

type SortableSidebarEntry = {
  title?: string;
  lastActivityAt: number;
  createdAt?: number;
};

function createdTime(entry: SortableSidebarEntry): number {
  const created = Number(entry.createdAt);
  return Number.isFinite(created) && created > 0
    ? created
    : entry.lastActivityAt;
}

/** The time a row's date shows: when it was made in "Date created" order. */
export function getStandaloneSidebarEntryTime(
  entry: SortableSidebarEntry,
  order: StandaloneSidebarSortOrder,
): number {
  return order === "created" ? createdTime(entry) : entry.lastActivityAt;
}

/** A sorted copy; ties keep the order the entries came in. */
export function sortStandaloneSidebarEntries<T extends SortableSidebarEntry>(
  entries: readonly T[],
  order: StandaloneSidebarSortOrder,
): T[] {
  const sorted = entries.slice();
  if (order === "title") {
    const collator = new Intl.Collator(undefined, {
      sensitivity: "base",
      numeric: true,
    });
    sorted.sort((a, b) =>
      collator.compare((a.title || "").trim(), (b.title || "").trim()),
    );
  } else if (order === "created") {
    sorted.sort((a, b) => createdTime(b) - createdTime(a));
  } else {
    sorted.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }
  return sorted;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * "now", "5h", "3d" within a week; then "Oct 2" this year, or the year.
 */
export function formatStandaloneSidebarShortDate(
  timestamp: number,
  options?: { now?: number; translate?: (value: string) => string },
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const now = options?.now ?? Date.now();
  const translate = options?.translate ?? ((value: string) => value);
  const diff = Math.max(0, now - timestamp);
  if (diff < HOUR_MS) return translate("now");
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h`;
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d`;
  const date = new Date(timestamp);
  if (date.getFullYear() !== new Date(now).getFullYear()) {
    return String(date.getFullYear());
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
