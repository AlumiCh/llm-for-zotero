import { HTML_NS } from "../../utils/domHelpers";
import {
  getStandaloneSidebarSortMenuLabel,
  STANDALONE_SIDEBAR_SORT_ORDERS,
  type StandaloneSidebarSortOrder,
} from "./standaloneSidebarSort";

export type StandaloneSidebarState = "expanded" | "collapsed";

export type StandaloneSidebarView = {
  root: HTMLElement;
  panel: HTMLDivElement;
  header: HTMLDivElement;
  primaryNavigation: HTMLElement;
  /**
   * Reserved box the platform draws its native window controls into once the
   * document opts out of the native title bar. Empty and hidden otherwise.
   */
  windowButtons: HTMLDivElement;
  toggleButton: HTMLButtonElement;
  /**
   * Where the window controls and the collapse toggle live while the rail is
   * not rendered. Null keeps both in the header.
   */
  collapsedChromeHost: HTMLElement | null;
  newChatButton: HTMLButtonElement;
  newChatLabel: HTMLSpanElement;
  searchButton: HTMLButtonElement;
  skillsButton: HTMLButtonElement;
  skillsLabel: HTMLSpanElement;
  refreshButton: HTMLButtonElement;
  /** "Pinned papers": its label and rows; hidden while nothing is pinned. */
  pinnedRegion: HTMLDivElement;
  pinnedList: HTMLDivElement;
  pinnedClear: HTMLButtonElement;
  historyRegion: HTMLDivElement;
  /** "Conversations" label row above the list, with the sort button. */
  historyHeader: HTMLDivElement;
  historySortButton: HTMLButtonElement;
  historySortButtonLabel: HTMLSpanElement;
  /** The sort button's menu; floats over the panel while open. */
  historySortMenu: HTMLDivElement;
  historySortItems: Map<StandaloneSidebarSortOrder, HTMLButtonElement>;
  historyShowDatesItem: HTMLButtonElement;
  undo: HTMLDivElement;
  undoText: HTMLSpanElement;
  undoButton: HTMLButtonElement;
  list: HTMLDivElement;
  preferencesRegion: HTMLDivElement;
  footerDivider: HTMLDivElement;
  /** Preferences row plus the plugin update control at its right end. */
  footerRow: HTMLDivElement;
  /** Empty box at the right end of the footer row; the update control fills it. */
  updateSlot: HTMLDivElement;
  preferencesButton: HTMLButtonElement;
  preferencesLabel: HTMLSpanElement;
  resizeHandle: HTMLDivElement;
  translate: (value: string) => string;
};

type SidebarNavRow = {
  button: HTMLButtonElement;
  label: HTMLSpanElement;
};

function createHtmlElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElementNS(
    HTML_NS,
    tagName,
  ) as HTMLElementTagNameMap[K];
  element.className = className;
  return element;
}

function createNavRow(
  doc: Document,
  action: string,
  labelText: string,
  iconClassName: string,
): SidebarNavRow {
  const button = createHtmlElement(
    doc,
    "button",
    `llm-standalone-nav-row llm-standalone-nav-${action}`,
  );
  button.type = "button";
  button.dataset.sidebarAction = action;
  button.title = labelText;
  button.setAttribute("aria-label", labelText);

  const icon = createHtmlElement(
    doc,
    "span",
    `llm-standalone-nav-icon ${iconClassName}`,
  );
  icon.setAttribute("aria-hidden", "true");

  const label = createHtmlElement(doc, "span", "llm-standalone-nav-label");
  label.textContent = labelText;
  button.append(icon, label);
  return { button, label };
}

export function createStandaloneSidebarView(
  doc: Document,
  translate: (value: string) => string,
): StandaloneSidebarView {
  const root = createHtmlElement(doc, "aside", "llm-standalone-sidebar");
  root.setAttribute("aria-label", translate("Standalone navigation"));

  const panel = createHtmlElement(doc, "div", "llm-standalone-sidebar-panel");
  panel.id = "llm-standalone-sidebar-panel";

  const header = createHtmlElement(doc, "div", "llm-standalone-sidebar-header");
  const windowButtons = createHtmlElement(doc, "div", "llm-window-buttons");
  windowButtons.setAttribute("aria-hidden", "true");
  const toggleButton = createHtmlElement(
    doc,
    "button",
    "llm-standalone-nav-toggle",
  );
  toggleButton.type = "button";
  toggleButton.setAttribute("aria-controls", panel.id);
  header.append(windowButtons, toggleButton);

  const primaryNavigation = createHtmlElement(
    doc,
    "nav",
    "llm-standalone-primary-nav",
  );
  primaryNavigation.setAttribute("aria-label", translate("Chat actions"));

  const newChat = createNavRow(
    doc,
    "new-chat",
    translate("New chat"),
    "llm-standalone-nav-icon-new-chat",
  );
  const search = createNavRow(
    doc,
    "search-history",
    translate("Search history"),
    "llm-standalone-nav-icon-search",
  );
  const skills = createNavRow(
    doc,
    "skills",
    translate("Skills"),
    "llm-standalone-nav-icon-skills",
  );

  const refreshButton = createHtmlElement(
    doc,
    "button",
    "llm-standalone-nav-aux-action llm-standalone-sidebar-refresh",
  );
  refreshButton.type = "button";
  refreshButton.textContent = "\u21BB";
  refreshButton.title = translate("Refresh web history");
  refreshButton.setAttribute("aria-label", translate("Refresh web history"));
  refreshButton.style.display = "none";

  const searchNavigationRow = createHtmlElement(
    doc,
    "div",
    "llm-standalone-primary-action-group",
  );
  searchNavigationRow.append(search.button, refreshButton);
  primaryNavigation.append(newChat.button, searchNavigationRow, skills.button);

  const pinnedRegion = createHtmlElement(
    doc,
    "div",
    "llm-standalone-pinned-region",
  );
  pinnedRegion.setAttribute("aria-label", translate("Pinned papers"));
  const pinnedHeader = createHtmlElement(
    doc,
    "div",
    "llm-standalone-day-label llm-standalone-pinned-label",
  );
  const pinnedLabel = createHtmlElement(
    doc,
    "span",
    "llm-standalone-pinned-label-text",
  );
  pinnedLabel.textContent = translate("Pinned papers");
  const pinnedClear = createHtmlElement(
    doc,
    "button",
    "llm-standalone-pinned-clear",
  );
  pinnedClear.type = "button";
  pinnedClear.textContent = translate("Clear");
  pinnedClear.title = translate("Unpin all papers");
  pinnedClear.setAttribute("aria-label", translate("Unpin all papers"));
  pinnedClear.hidden = true;
  pinnedHeader.append(pinnedLabel, pinnedClear);
  const pinnedList = createHtmlElement(
    doc,
    "div",
    "llm-standalone-pinned-list",
  );
  pinnedRegion.append(pinnedHeader, pinnedList);

  const historyRegion = createHtmlElement(
    doc,
    "div",
    "llm-standalone-history-region",
  );
  historyRegion.id = "llm-standalone-history-region";

  // Same label style as "Pinned papers"; the sort button sits at its end.
  const historyHeader = createHtmlElement(
    doc,
    "div",
    "llm-standalone-history-header",
  );
  const historyLabel = createHtmlElement(
    doc,
    "div",
    "llm-standalone-day-label llm-standalone-history-label",
  );
  const historyLabelText = createHtmlElement(
    doc,
    "span",
    "llm-standalone-history-label-text",
  );
  historyLabelText.textContent = translate("Conversations");
  const historySortButton = createHtmlElement(
    doc,
    "button",
    "llm-standalone-history-sort",
  );
  historySortButton.type = "button";
  historySortButton.title = translate("Sort conversations");
  historySortButton.setAttribute("aria-label", historySortButton.title);
  historySortButton.setAttribute("aria-haspopup", "menu");
  historySortButton.setAttribute("aria-expanded", "false");
  const historySortButtonLabel = createHtmlElement(
    doc,
    "span",
    "llm-standalone-history-sort-label",
  );
  historySortButton.append(historySortButtonLabel);
  historyLabel.append(historyLabelText, historySortButton);
  historyHeader.append(historyLabel);

  const historySortMenu = createHtmlElement(
    doc,
    "div",
    "llm-standalone-history-sort-menu",
  );
  historySortMenu.setAttribute("role", "menu");
  historySortMenu.setAttribute("aria-label", translate("Sort conversations"));
  historySortMenu.hidden = true;
  const sortMenuTitle = createHtmlElement(
    doc,
    "div",
    "llm-standalone-history-sort-menu-title",
  );
  sortMenuTitle.textContent = translate("Sort by");
  historySortMenu.append(sortMenuTitle);
  const createSortMenuItem = (role: string, text: string) => {
    const item = createHtmlElement(
      doc,
      "button",
      "llm-standalone-history-sort-item",
    );
    item.type = "button";
    item.setAttribute("role", role);
    item.setAttribute("aria-checked", "false");
    item.textContent = text;
    historySortMenu.append(item);
    return item;
  };
  const historySortItems = new Map<
    StandaloneSidebarSortOrder,
    HTMLButtonElement
  >();
  for (const order of STANDALONE_SIDEBAR_SORT_ORDERS) {
    const item = createSortMenuItem(
      "menuitemradio",
      translate(getStandaloneSidebarSortMenuLabel(order)),
    );
    item.dataset.sortOrder = order;
    historySortItems.set(order, item);
  }
  historySortMenu.append(
    createHtmlElement(doc, "div", "llm-standalone-history-sort-separator"),
  );
  const historyShowDatesItem = createSortMenuItem(
    "menuitemcheckbox",
    translate("Show dates"),
  );
  historyShowDatesItem.dataset.sortToggle = "dates";
  const undo = createHtmlElement(
    doc,
    "div",
    "llm-history-undo llm-standalone-history-undo",
  );
  undo.style.display = "none";
  const undoText = createHtmlElement(doc, "span", "llm-history-undo-text");
  const undoButton = createHtmlElement(doc, "button", "llm-history-undo-btn");
  undoButton.type = "button";
  undoButton.textContent = translate("Undo");
  undoButton.title = translate("Restore deleted conversation");
  undo.append(undoText, undoButton);

  const list = createHtmlElement(doc, "div", "llm-standalone-sidebar-list");
  list.id = "llm-standalone-sidebar-list";
  historyRegion.append(historyHeader, undo, list);

  const preferencesRegion = createHtmlElement(
    doc,
    "div",
    "llm-standalone-preferences-region",
  );
  const footerDivider = createHtmlElement(
    doc,
    "div",
    "llm-standalone-nav-divider llm-standalone-footer-divider",
  );
  const preferences = createNavRow(
    doc,
    "preferences",
    translate("Preferences"),
    "llm-standalone-nav-icon-preferences",
  );
  const footerRow = createHtmlElement(doc, "div", "llm-standalone-footer-row");
  const updateSlot = createHtmlElement(
    doc,
    "div",
    "llm-standalone-update-slot",
  );
  footerRow.append(preferences.button, updateSlot);
  preferencesRegion.append(footerDivider, footerRow);

  panel.append(
    header,
    primaryNavigation,
    pinnedRegion,
    historyRegion,
    preferencesRegion,
    historySortMenu,
  );

  const resizeHandle = createHtmlElement(
    doc,
    "div",
    "llm-standalone-sidebar-resizer",
  );
  resizeHandle.tabIndex = 0;
  resizeHandle.title = translate("Drag to resize chat sidebar");
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.setAttribute("aria-label", translate("Resize chat sidebar"));
  root.append(panel, resizeHandle);

  const view: StandaloneSidebarView = {
    root,
    panel,
    header,
    primaryNavigation,
    windowButtons,
    toggleButton,
    collapsedChromeHost: null,
    newChatButton: newChat.button,
    newChatLabel: newChat.label,
    searchButton: search.button,
    skillsButton: skills.button,
    skillsLabel: skills.label,
    refreshButton,
    pinnedRegion,
    pinnedList,
    pinnedClear,
    historyRegion,
    historyHeader,
    historySortButton,
    historySortButtonLabel,
    historySortMenu,
    historySortItems,
    historyShowDatesItem,
    undo,
    undoText,
    undoButton,
    list,
    preferencesRegion,
    footerDivider,
    footerRow,
    updateSlot,
    preferencesButton: preferences.button,
    preferencesLabel: preferences.label,
    resizeHandle,
    translate,
  };
  setStandaloneSidebarState(view, "expanded");
  return view;
}

export function setStandaloneSidebarState(
  view: StandaloneSidebarView,
  state: StandaloneSidebarState,
): void {
  const expanded = state === "expanded";
  view.root.dataset.sidebarState = state;
  view.toggleButton.title = view.translate(
    expanded ? "Collapse sidebar" : "Expand sidebar",
  );
  view.toggleButton.setAttribute("aria-label", view.toggleButton.title);
  placeWindowChrome(view, expanded);
  // A flyout belongs to one collapsed moment; any state change ends it.
  setStandaloneSidebarFlyoutOpen(view, false);
}

/**
 * Offers the row that holds the window controls and the collapse toggle while
 * the rail is collapsed away. The collapsed sidebar renders nothing at all, so
 * both have to live somewhere else for the whole time it is hidden.
 */
export function setStandaloneSidebarCollapsedChromeHost(
  view: StandaloneSidebarView,
  host: HTMLElement | null,
): void {
  view.collapsedChromeHost = host;
  placeWindowChrome(view, view.root.dataset.sidebarState !== "collapsed");
}

/** Hover reveal of the collapsed sidebar, independent of the pinned state. */
export function setStandaloneSidebarFlyoutOpen(
  view: StandaloneSidebarView,
  open: boolean,
): void {
  view.root.dataset.sidebarFlyout = open ? "open" : "closed";
  view.toggleButton.setAttribute(
    "aria-expanded",
    String(view.root.dataset.sidebarState === "expanded" || open),
  );
}

function placeWindowChrome(
  view: StandaloneSidebarView,
  expanded: boolean,
): void {
  const host = !expanded && view.collapsedChromeHost;
  if (!host) {
    view.header.append(view.windowButtons, view.toggleButton);
    return;
  }
  host.prepend(view.windowButtons, view.toggleButton);
}
