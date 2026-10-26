/**
 * The one place that builds a frame for model-written HTML.
 *
 * Model output is untrusted. The frame runs it with scripts but without a
 * same-origin principal, so it cannot reach the chrome document, Zotero, the
 * network, or open windows. Keep every HTML-preview frame on this helper so
 * the sandbox and the content security policy cannot drift between callers.
 */

import { t } from "../../utils/i18n";
import {
  PREVIEW_SURFACE_ATTRIBUTE,
  PREVIEW_THEME_ATTRIBUTE,
  buildHtmlPreviewThemeSheet,
  needsPreviewThemeSheet,
  previewSurfaceFor,
  previewThemeFor,
  type PreviewThemeKey,
} from "../../utils/previewTheme";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** The only sandbox token the preview frame gets. */
export const HTML_PREVIEW_SANDBOX = "allow-scripts";

/** No network; inline script and style plus data/blob media only. */
export const HTML_PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

export const HTML_PREVIEW_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`;

/**
 * Leading tags that may stay ahead of the CSP meta: a doctype (so the page
 * keeps standards mode), then an opening <html> and <head>. None of them can
 * run script, so the meta is still parsed before any of the model's content.
 */
const SRCDOC_PREAMBLE_PATTERN =
  /^(\s*<!doctype[^>]*>)?(\s*<html(?:\s[^>]*)?>)?(\s*<head(?:\s[^>]*)?>)?/i;

/**
 * The frame document: the CSP meta first, so it is parsed before the markup.
 * With an app theme, the theme sheet (previewTheme.ts) follows the meta, still
 * ahead of the model's own markup.
 */
export function buildHtmlPreviewSrcdoc(
  source: string,
  appTheme?: PreviewThemeKey,
): string {
  const preamble = source.match(SRCDOC_PREAMBLE_PATTERN)?.[0] ?? "";
  const sheet = appTheme
    ? buildHtmlPreviewThemeSheet(
        previewThemeFor(source, appTheme),
        previewSurfaceFor(source),
        needsPreviewThemeSheet(source),
      )
    : "";
  return `${preamble}${HTML_PREVIEW_CSP_META}${sheet}${source.slice(preamble.length)}`;
}

export const HTML_PREVIEW_STOPPED_TEXT =
  "Preview stopped: the page tried to leave.";

/**
 * The CSP does not stop the page from navigating its own frame (for example
 * `location = "https://..."`). The first load is the srcdoc; any later load
 * means the frame left it, so the frame is removed and replaced by a note.
 * Returns the load handler so tests can drive it.
 */
export function guardHtmlPreviewNavigation(
  doc: Document,
  frame: HTMLIFrameElement,
): () => void {
  let loads = 0;
  const onLoad = () => {
    loads += 1;
    if (loads === 1) return;
    frame.removeEventListener("load", onLoad);
    frame.removeAttribute("srcdoc");
    const note = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    note.setAttribute("class", "llm-html-preview-stopped");
    note.textContent = t(HTML_PREVIEW_STOPPED_TEXT);
    const parent = frame.parentNode;
    if (parent) {
      parent.replaceChild(note, frame);
    }
  };
  frame.addEventListener("load", onLoad);
  return onLoad;
}

/**
 * Never add a message listener for the frame's postMessage: the page is
 * untrusted and must have no channel back into the plugin.
 */
export function createSandboxedHtmlFrame(
  doc: Document,
  source: string,
  className = "llm-html-preview-frame",
  appTheme?: PreviewThemeKey,
): HTMLIFrameElement {
  const frame = doc.createElementNS(XHTML_NS, "iframe") as HTMLIFrameElement;
  // The sandbox must be in place before srcdoc is set and before the frame
  // is inserted, so the document never loads without it.
  frame.setAttribute("sandbox", HTML_PREVIEW_SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", t("HTML preview"));
  frame.setAttribute("class", className);
  if (appTheme) {
    // A page's colors are fixed when its frame is built: a theme change
    // builds a new frame (srcdoc is never set twice, see the guard below).
    frame.setAttribute(PREVIEW_SURFACE_ATTRIBUTE, previewSurfaceFor(source));
    frame.setAttribute(
      PREVIEW_THEME_ATTRIBUTE,
      previewThemeFor(source, appTheme),
    );
  }
  guardHtmlPreviewNavigation(doc, frame);
  frame.setAttribute("srcdoc", buildHtmlPreviewSrcdoc(source, appTheme));
  return frame;
}
