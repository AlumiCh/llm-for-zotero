/**
 * The side panel's Web sources tab (standalone window).
 *
 * Two views in one tab, like a small browser:
 * - the list: every web page the chat's agent runs found, grouped by
 *   question (newest first), with the same signs as Task progress papers
 *   (a green check when the agent opened the page, "found" when it only saw
 *   it in search results, a "Cited" tag when the answer cites it);
 * - a page: the live web page, or "What the agent read" (the text the agent
 *   got for it), chosen with two flat tabs under the title row.
 * ← at the start of the title row goes back: inside the page first (a link
 * the reader followed there), then to what the tab showed before.
 *
 * The page runs in a content <browser> as in Zotero's own web viewer, never
 * with the plugin's privileges, and cannot open pop-up windows.
 */
import { appLogger } from "../../core/logging";
import { createElement } from "../../utils/domHelpers";
import { t } from "../../utils/i18n";
import { createWebFaviconImage } from "./webFavicon";
import {
  findWebSourceEntry,
  webSourceKey,
  type WebSourceListEntry,
  type WebSourceQuestionGroup,
} from "./webSourcesData";
import {
  launchInDefaultBrowser,
  toPublicWebUrl,
  wantsDefaultBrowser,
  type WebSourceLink,
} from "./webSourcesSidePanel";

/** The page cannot open pop-up windows (SANDBOXED_AUXILIARY_NAVIGATION). */
const SANDBOXED_AUXILIARY_NAVIGATION = 0x2;

export type WebSourcesTabMode = "page" | "text";

type TabState =
  | {
      view: "list";
      highlight: string[];
      /** The questions shown open (their run ids); unset = the default. */
      open?: string[];
    }
  | { view: "page"; link: WebSourceLink; mode: WebSourcesTabMode };

export type WebSourcesTabDeps = {
  doc: Document;
  win: Window;
  /** The panel's title row (same row as the main chat's title). */
  createTitleRow: (title: string) => {
    row: HTMLElement;
    text: HTMLElement;
    actions: HTMLElement;
  };
  createIconButton: (iconClass: string, label: string) => HTMLButtonElement;
  createPill: (label: string) => HTMLElement;
  /** The main chat's pages, grouped by question (oldest first). */
  loadGroups: () => Promise<WebSourceQuestionGroup[]>;
  copyText: (text: string) => Promise<void>;
};

export type WebSourcesTabView = {
  root: HTMLElement;
  showList: (highlightUrls: readonly string[]) => void;
  showPage: (link: WebSourceLink) => void;
  /** The main chat changed: read its pages again. */
  refresh: () => void;
  /** The main chat got new messages: read again, keeping what shows. */
  reloadQuietly: () => void;
  dispose: () => void;
};

type BrowserElement = HTMLElement & {
  browsingContext?: { sandboxFlags: number };
  loadURI?: (uri: unknown, params: Record<string, unknown>) => void;
  canGoBack?: boolean;
  goBack?: () => void;
  stop?: () => void;
  currentURI?: { spec?: string };
  contentTitle?: string;
};

function createSiteIcon(doc: Document, faviconUrl?: string): HTMLElement {
  const icon = createElement(doc, "span", "llm-web-sources-site-icon");
  icon.setAttribute("aria-hidden", "true");
  const image = createWebFaviconImage(
    doc,
    faviconUrl,
    "llm-web-sources-favicon",
  );
  if (image) {
    icon.classList.add("llm-web-sources-site-icon-has-favicon");
    image.addEventListener("error", () =>
      icon.classList.remove("llm-web-sources-site-icon-has-favicon"),
    );
    icon.appendChild(image);
  }
  return icon;
}

/**
 * The text as passages: the web service sends the parts of a page that match
 * the agent's question, joined with "[...]"; blank lines split them too.
 */
export function splitAgentTextPassages(text: string): string[] {
  return text
    .split(/\s*\[(?:\.\.\.|…)\]\s*|\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function mountWebSourcesTab(deps: WebSourcesTabDeps): WebSourcesTabView {
  const { doc, win } = deps;
  const root = createElement(doc, "div", "llm-standalone-side-panel-web");
  root.dataset.sideView = "web";

  const { row, text, actions } = deps.createTitleRow(t("Web sources"));
  const back = deps.createIconButton(
    "llm-standalone-side-panel-item-action llm-standalone-side-panel-icon-back",
    t("Back"),
  );
  back.dataset.webAction = "back";
  row.prepend(back);
  const titleIcon = createElement(doc, "span", "llm-web-sources-title-icon");
  text.before(titleIcon);
  const pill = deps.createPill("");
  text.after(pill);
  const copyButton = deps.createIconButton(
    "llm-standalone-side-panel-item-action llm-standalone-side-panel-icon-copy",
    t("Copy link"),
  );
  copyButton.dataset.webAction = "copy";
  const browserButton = deps.createIconButton(
    "llm-standalone-side-panel-item-action llm-standalone-side-panel-icon-web-browser",
    t("Open in default browser"),
  );
  browserButton.dataset.webAction = "browser";
  actions.append(copyButton, browserButton);

  const status = createElement(
    doc,
    "div",
    "llm-standalone-side-panel-item-status",
  );
  status.setAttribute("role", "status");
  status.hidden = true;

  // "Page | What the agent read": flat text tabs, underline on the chosen one.
  const modes = createElement(doc, "div", "llm-web-sources-modes");
  modes.setAttribute("role", "tablist");
  const makeMode = (mode: WebSourcesTabMode, label: string) => {
    const button = createElement(doc, "button", "llm-web-sources-mode", {
      type: "button",
      textContent: label,
    });
    button.setAttribute("role", "tab");
    button.dataset.webMode = mode;
    button.addEventListener("click", () => setMode(mode));
    modes.appendChild(button);
    return button;
  };
  const pageModeButton = makeMode("page", t("Page"));
  const textModeButton = makeMode("text", t("What the agent read"));

  const list = createElement(
    doc,
    "div",
    "llm-standalone-search-results llm-web-sources-list",
  );
  const pageHost = createElement(doc, "div", "llm-web-sources-page");
  const textHost = createElement(doc, "div", "llm-web-sources-text");
  root.append(row, status, modes, list, pageHost, textHost);

  let stack: TabState[] = [];
  let groups: WebSourceQuestionGroup[] | null = null;
  let loadRun = 0;
  let disposed = false;
  let browser: BrowserElement | null = null;
  let loadedUrl = "";
  let feedbackTimer: number | null = null;

  const current = () => stack[stack.length - 1] || null;

  const showFeedback = (message: string) => {
    status.textContent = message;
    status.hidden = false;
    if (feedbackTimer !== null) win.clearTimeout(feedbackTimer);
    feedbackTimer = win.setTimeout(() => {
      feedbackTimer = null;
      status.hidden = true;
    }, 2000);
  };

  /** The page the tab shows now: where the reader is in the page, if web. */
  const currentPageUrl = (): string => {
    const state = current();
    if (state?.view !== "page") return "";
    const spec = browser && !browser.hidden ? browser.currentURI?.spec : "";
    return toPublicWebUrl(spec) || state.link.url;
  };

  const copyLink = (url: string) => {
    void deps
      .copyText(url)
      .then(() => showFeedback(t("Link copied")))
      .catch((err) => appLogger.warn("LLM: copy web link failed", err));
  };

  // -- Data -------------------------------------------------------------------
  const load = () => {
    const run = ++loadRun;
    void deps
      .loadGroups()
      .then((next) => {
        if (disposed || run !== loadRun) return;
        groups = next;
        render();
      })
      .catch((err) => {
        appLogger.warn("LLM: Web sources list failed", err);
        if (disposed || run !== loadRun) return;
        groups = [];
        render();
      });
  };

  // -- The list ---------------------------------------------------------------
  const createChevron = () => {
    const chevron = createElement(doc, "span", "llm-web-sources-chevron");
    chevron.setAttribute("aria-hidden", "true");
    const ns = "http://www.w3.org/2000/svg";
    const icon = doc.createElementNS(ns, "svg");
    for (const [name, value] of Object.entries({
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2.2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    })) {
      icon.setAttribute(name, value);
    }
    const path = doc.createElementNS(ns, "path");
    path.setAttribute("d", "M6 9l6 6 6-6");
    icon.appendChild(path);
    chevron.appendChild(icon);
    return chevron;
  };

  const countWords = (group: WebSourceQuestionGroup): string[] => {
    const pages = group.sources.length;
    const opened = group.sources.filter((source) => source.read).length;
    const cited = group.sources.filter((source) => source.cited).length;
    return [
      t("Question {n}").replace("{n}", `${group.questionNumber}`),
      (pages === 1 ? t("1 page") : t("{count} pages")).replace(
        "{count}",
        `${pages}`,
      ),
      opened ? t("{count} opened").replace("{count}", `${opened}`) : "",
      cited ? t("{count} cited").replace("{count}", `${cited}`) : "",
    ];
  };

  const renderList = (state: Extract<TabState, { view: "list" }>) => {
    list.replaceChildren();
    if (!groups) {
      list.appendChild(
        createElement(doc, "div", "llm-standalone-search-empty", {
          textContent: t("Loading…"),
        }),
      );
      return;
    }
    const total = groups.reduce((sum, group) => sum + group.sources.length, 0);
    pill.textContent = String(total);
    pill.hidden = !total;
    if (!total) {
      list.appendChild(
        createElement(doc, "div", "llm-standalone-search-empty", {
          textContent: t("No web pages in this chat yet"),
        }),
      );
      return;
    }
    const marked = new Set(state.highlight.map(webSourceKey));
    // Open by default: the questions holding the clicked marker's pages,
    // else the newest question.
    if (!state.open) {
      const holding = groups
        .filter((group) =>
          group.sources.some((source) => marked.has(webSourceKey(source.url))),
        )
        .map((group) => group.runId);
      state.open = holding.length ? holding : [groups[groups.length - 1].runId];
    }
    const open = new Set(state.open);
    let firstMarked: HTMLElement | null = null;
    // One block per question, newest first, as in Task progress.
    for (const group of [...groups].reverse()) {
      const section = createElement(doc, "div", "llm-web-sources-question");
      const head = createElement(
        doc,
        "button",
        "llm-web-sources-question-head",
        {
          type: "button",
        },
      );
      const icon = createElement(doc, "span", "llm-web-sources-question-icon");
      icon.setAttribute("aria-hidden", "true");
      const words = createElement(
        doc,
        "span",
        "llm-web-sources-question-words",
        {
          textContent:
            group.question ||
            t("Question {n}").replace("{n}", `${group.questionNumber}`),
        },
      );
      words.title = group.question;
      const meta = createElement(doc, "span", "llm-web-sources-question-meta");
      for (const part of countWords(group)) {
        meta.append(createElement(doc, "span", "", { textContent: part }));
      }
      head.append(icon, words, createChevron(), meta);
      const body = createElement(doc, "div", "llm-web-sources-question-body");
      const isOpen = open.has(group.runId);
      head.setAttribute("aria-expanded", String(isOpen));
      body.hidden = !isOpen;
      group.sources.forEach((source, index) => {
        const item = buildRow(source, index + 1);
        if (marked.has(webSourceKey(source.url))) {
          item.classList.add("llm-web-sources-row-highlighted");
          if (isOpen) firstMarked ||= item;
        }
        body.appendChild(item);
      });
      head.addEventListener("click", () => {
        const nowOpen = body.hidden;
        body.hidden = !nowOpen;
        head.setAttribute("aria-expanded", String(nowOpen));
        state.open = nowOpen
          ? [...(state.open || []), group.runId]
          : (state.open || []).filter((runId) => runId !== group.runId);
      });
      section.append(head, body);
      list.appendChild(section);
    }
    const target = firstMarked as HTMLElement | null;
    if (target) {
      const run = () => target.scrollIntoView?.({ block: "nearest" });
      if (typeof win.requestAnimationFrame === "function") {
        win.requestAnimationFrame(run);
      } else {
        run();
      }
    }
  };

  const buildRow = (source: WebSourceListEntry, number: number) => {
    const item = createElement(
      doc,
      "div",
      "llm-standalone-search-item llm-web-sources-row",
    );
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.dataset.webUrl = source.url;
    item.title = source.title;
    const numberLabel = createElement(doc, "span", "llm-web-sources-number", {
      textContent: String(number),
    });
    const main = createElement(doc, "div", "llm-web-sources-row-main");
    const titleLine = createElement(doc, "div", "llm-standalone-search-text");
    titleLine.append(
      createElement(doc, "span", "llm-standalone-search-title", {
        textContent: source.title,
      }),
    );
    if (source.cited) {
      titleLine.append(
        createElement(doc, "span", "llm-web-sources-cited", {
          textContent: t("Cited"),
        }),
      );
    }
    const meta = createElement(doc, "div", "llm-standalone-search-meta", {
      textContent:
        source.organization && source.organization !== source.hostname
          ? `${source.organization} · ${source.hostname}`
          : source.hostname,
    });
    main.append(titleLine, meta);
    const state = createElement(doc, "span", "llm-web-sources-state");
    state.dataset.read = source.read ? "true" : "false";
    const sign = createElement(doc, "span", "llm-web-sources-sign");
    sign.setAttribute("aria-hidden", "true");
    state.appendChild(sign);
    if (!source.read) {
      state.appendChild(doc.createTextNode(t("found")));
    }
    state.title = source.read
      ? t("The agent opened this page")
      : t("The agent only saw this page in search results");
    const rowActions = createElement(
      doc,
      "span",
      "llm-web-sources-row-actions",
    );
    const makeRowAction = (name: string, label: string, run: () => void) => {
      const button = deps.createIconButton(
        `llm-web-sources-row-action llm-standalone-side-panel-icon-${name}`,
        label,
      );
      button.tabIndex = -1;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      return button;
    };
    rowActions.append(
      makeRowAction("copy", t("Copy link"), () => copyLink(source.url)),
      makeRowAction("web-browser", t("Open in default browser"), () => {
        launchInDefaultBrowser(source.url);
      }),
    );
    item.append(
      numberLabel,
      createSiteIcon(doc, source.faviconUrl),
      main,
      state,
      rowActions,
    );
    const link: WebSourceLink = {
      url: source.url,
      title: source.title,
      organization: source.organization,
      hostname: source.hostname,
      faviconUrl: source.faviconUrl,
    };
    item.addEventListener("click", (event) => {
      if (wantsDefaultBrowser(event)) {
        launchInDefaultBrowser(source.url);
        return;
      }
      showPage(link);
    });
    item.addEventListener("keydown", (event) => {
      if (event.target !== item) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showPage(link);
      }
    });
    return item;
  };

  // -- The page ---------------------------------------------------------------
  const ensureBrowser = (): BrowserElement | null => {
    if (browser) return browser;
    const create = (
      doc as Document & { createXULElement?: (tag: string) => Element }
    ).createXULElement;
    if (typeof create !== "function") return null;
    try {
      const element = create.call(doc, "browser") as BrowserElement;
      // As Zotero's own web viewer: a content browser that moves to a web
      // content process when it loads a page, without global history.
      element.setAttribute("type", "content");
      element.setAttribute("remote", "false");
      element.setAttribute("maychangeremoteness", "true");
      element.setAttribute("disableglobalhistory", "true");
      element.setAttribute("messagemanagergroup", "llmWebSources");
      element.setAttribute("class", "llm-web-sources-browser");
      element.addEventListener("pagetitlechanged", () => render());
      pageHost.appendChild(element);
      browser = element;
      return element;
    } catch (err) {
      appLogger.warn("LLM: web page view could not be created", err);
      return null;
    }
  };

  const showPageFallback = (url: string) => {
    pageHost.replaceChildren();
    browser = null;
    loadedUrl = "";
    const note = createElement(doc, "div", "llm-web-sources-page-note");
    note.append(
      createElement(doc, "div", "", {
        textContent: t("This page cannot be shown here."),
      }),
    );
    const open = createElement(doc, "button", "llm-web-sources-page-open", {
      type: "button",
      textContent: t("Open in default browser"),
    });
    open.addEventListener("click", () => launchInDefaultBrowser(url));
    note.append(open);
    pageHost.appendChild(note);
  };

  const loadPage = (url: string) => {
    if (loadedUrl === url && browser) return;
    // Each page gets a fresh view, so its Back history starts at that page:
    // Back never lands on the page shown before it.
    if (browser) {
      try {
        browser.stop?.();
      } catch {
        /* ignore */
      }
      browser.remove();
      browser = null;
    }
    const element = ensureBrowser();
    const services = (globalThis as { Services?: any }).Services;
    if (!element || !services?.io || typeof element.loadURI !== "function") {
      showPageFallback(url);
      return;
    }
    try {
      const uri = services.io.newURI(url);
      const context = element.browsingContext;
      if (context) context.sandboxFlags |= SANDBOXED_AUXILIARY_NAVIGATION;
      element.loadURI(uri, {
        triggeringPrincipal:
          services.scriptSecurityManager.createContentPrincipal(uri, {}),
      });
      loadedUrl = url;
    } catch (err) {
      appLogger.warn("LLM: web page could not be loaded", err);
      showPageFallback(url);
    }
  };

  const renderAgentText = (link: WebSourceLink) => {
    textHost.replaceChildren();
    const entry = groups ? findWebSourceEntry(groups, link.url) : null;
    const note = createElement(doc, "div", "llm-web-sources-text-note");
    const body = createElement(doc, "div", "llm-web-sources-text-body");
    if (!groups) {
      note.textContent = t("Loading…");
    } else if (!entry || !entry.agentText) {
      note.textContent = t(
        "The agent did not read this page. It only appears as a link in the answer.",
      );
    } else {
      note.textContent =
        entry.coverage === "whole"
          ? t("The agent read this whole page.")
          : entry.coverage === "parts"
            ? t(
                "The parts of this page the agent read. It did not read the whole page.",
              )
            : entry.coverage === "outline"
              ? t(
                  "The agent only looked at this page's outline (its headings).",
                )
              : entry.coverage === "snippet"
                ? t(
                    "The agent only saw this short search result. It did not open the page.",
                  )
                : t(
                    "The parts of this page the agent got: the passages that matched its question, not the whole page.",
                  );
      for (const paragraph of splitAgentTextPassages(entry.agentText)) {
        body.appendChild(
          createElement(doc, "p", "", { textContent: paragraph }),
        );
      }
    }
    textHost.append(note, body);
  };

  const renderPageTitle = () => {
    const state = current();
    if (state?.view !== "page") return;
    const url = currentPageUrl();
    const onOriginal = webSourceKey(url) === webSourceKey(state.link.url);
    const liveTitle =
      state.mode === "page" && browser
        ? String(browser.contentTitle || "")
        : "";
    // The page's title as the agent found it, else the link's words, else
    // the live page's own title.
    const known = onOriginal && groups ? findWebSourceEntry(groups, url) : null;
    const title =
      known?.title || liveTitle || (onOriginal ? state.link.title : "") || url;
    let hostname = "";
    try {
      hostname = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      hostname = state.link.hostname || "";
    }
    text.textContent = title;
    row.title = url;
    pill.textContent = hostname;
    pill.hidden = !hostname;
  };

  // -- Rendering ----------------------------------------------------------------
  const render = () => {
    if (disposed) return;
    const state = current();
    if (!state) return;
    const canGoBackInPage =
      state.view === "page" &&
      state.mode === "page" &&
      Boolean(browser?.canGoBack) &&
      loadedUrl !== "";
    // A page always has a way back: to the page before, else to the list.
    back.hidden = state.view === "list" && stack.length < 2;
    const previous = stack[stack.length - 2];
    back.title =
      canGoBackInPage || previous?.view === "page"
        ? t("Back to the previous page")
        : t("Back to Web sources");
    back.setAttribute("aria-label", back.title);
    root.dataset.webView = state.view;
    if (state.view === "list") {
      titleIcon.replaceChildren();
      titleIcon.hidden = true;
      text.textContent = t("Web sources");
      row.title = "";
      copyButton.hidden = true;
      browserButton.hidden = true;
      modes.hidden = true;
      pageHost.hidden = true;
      textHost.hidden = true;
      list.hidden = false;
      pill.hidden = true;
      renderList(state);
      return;
    }
    titleIcon.replaceChildren(createSiteIcon(doc, state.link.faviconUrl));
    titleIcon.hidden = false;
    copyButton.hidden = false;
    browserButton.hidden = false;
    list.hidden = true;
    modes.hidden = false;
    pageModeButton.classList.toggle("active", state.mode === "page");
    pageModeButton.setAttribute("aria-selected", String(state.mode === "page"));
    textModeButton.classList.toggle("active", state.mode === "text");
    textModeButton.setAttribute("aria-selected", String(state.mode === "text"));
    pageHost.hidden = state.mode !== "page";
    textHost.hidden = state.mode !== "text";
    if (state.mode === "page") loadPage(state.link.url);
    else renderAgentText(state.link);
    renderPageTitle();
    alignModesWithTitle();
  };

  /** The flat tabs start where the title text starts. */
  const alignModesWithTitle = () => {
    const run = () => {
      const offset =
        text.getBoundingClientRect?.().left -
        root.getBoundingClientRect?.().left;
      if (Number.isFinite(offset) && offset > 0) {
        modes.style.paddingInlineStart = `${Math.round(offset)}px`;
      }
    };
    if (typeof win.requestAnimationFrame === "function") {
      win.requestAnimationFrame(run);
    } else {
      run();
    }
  };

  const push = (state: TabState) => {
    stack.push(state);
    // Keep the trail short; the oldest steps drop off.
    if (stack.length > 30) stack = stack.slice(-30);
    render();
  };

  const showList = (highlightUrls: readonly string[]) => {
    const state = current();
    // A list over a list would make Back do nothing visible: replace it.
    if (state?.view === "list") {
      stack[stack.length - 1] = { view: "list", highlight: [...highlightUrls] };
      render();
    } else {
      push({ view: "list", highlight: [...highlightUrls] });
    }
    load();
  };

  const showPage = (link: WebSourceLink) => {
    const url = toPublicWebUrl(link.url);
    if (!url) return;
    const state = current();
    if (
      state?.view === "page" &&
      webSourceKey(state.link.url) === webSourceKey(url)
    ) {
      if (state.mode !== "page") setMode("page");
      return;
    }
    loadedUrl = "";
    push({ view: "page", link: { ...link, url }, mode: "page" });
    if (!groups) load();
  };

  const setMode = (mode: WebSourcesTabMode) => {
    const state = current();
    if (state?.view !== "page" || state.mode === mode) return;
    state.mode = mode;
    render();
  };

  /** Back in the tab's own trail: the page or list before this one. */
  const goBackInTab = () => {
    const state = current();
    if (stack.length < 2) {
      if (state?.view !== "page") return;
      stack = [{ view: "list", highlight: [state.link.url] }];
      load();
      render();
      return;
    }
    stack.pop();
    const previous = current();
    if (previous?.view === "page") loadedUrl = "";
    render();
  };

  const goBack = () => {
    const state = current();
    const view = browser;
    if (
      state?.view === "page" &&
      state.mode === "page" &&
      view?.canGoBack &&
      typeof view.goBack === "function"
    ) {
      const before = webSourceKey(view.currentURI?.spec || "");
      view.goBack();
      win.setTimeout(() => {
        if (disposed || current() !== state || browser !== view) return;
        // A page that sends Back straight forward again (a redirect) would
        // trap Back: leave it for the tab's previous step instead.
        if (webSourceKey(view.currentURI?.spec || "") === before) {
          goBackInTab();
        } else {
          render();
        }
      }, 700);
      return;
    }
    goBackInTab();
  };

  back.addEventListener("click", goBack);
  copyButton.addEventListener("click", () => copyLink(currentPageUrl()));
  browserButton.addEventListener("click", () => {
    const url = currentPageUrl();
    if (url) launchInDefaultBrowser(url);
  });

  return {
    root,
    showList,
    showPage,
    refresh: () => {
      groups = null;
      load();
      render();
    },
    reloadQuietly: () => load(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      loadRun++;
      if (feedbackTimer !== null) win.clearTimeout(feedbackTimer);
      try {
        browser?.stop?.();
      } catch {
        /* ignore */
      }
      browser?.remove();
      browser = null;
      root.remove();
    },
  };
}
