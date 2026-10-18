import { isQuoteTokenId } from "./quoteTokenIds";

/** Paragraph support and reading recommendations share IDs, not presentation. */
const CITATION_RUN = /\[\[cite:[^\]\n]*\]\](?:[ \t]*\[\[cite:[^\]\n]*\]\])*/g;
/**
 * Models separate the ids of one footer with commas, semicolons or spaces;
 * none of those can occur inside an id, so each one ends an id.
 */
const CITATION_ID_SEPARATOR = /[,;\s]+/;

/**
 * `replace` receives the well-formed ids of each citation run, deduplicated,
 * and the entries that are not ids at all (`malformed`), which the run loses.
 */
export function transformParagraphCitations(
  markdown: string,
  replace: (ids: string[], malformed: string[]) => string,
): string {
  let fence: { char: string; length: number } | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const delimiter = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (delimiter) {
        if (!fence) fence = { char: delimiter[0], length: delimiter.length };
        else if (
          delimiter[0] === fence.char &&
          delimiter.length >= fence.length
        )
          fence = undefined;
        return line;
      }
      if (fence || /^(?: {4}|\t)/.test(line)) return line;
      // Preserve inline code (including code delimited by multiple backticks).
      return line
        .split(/(`+[^`]*(?:`(?!`)[^`]*)*?`+)/g)
        .map((part) => {
          if (part.startsWith("`")) return part;
          return part.replace(CITATION_RUN, (token, offset: number) => {
            if (offset > 0 && part[offset - 1] === "\\") return token;
            const entries = [
              ...token.matchAll(/\[\[cite:([^\]]+)\]\]/g),
            ].flatMap((match) =>
              match[1].split(CITATION_ID_SEPARATOR).filter(Boolean),
            );
            const ids = entries.filter(isQuoteTokenId);
            const malformed = entries.filter((entry) => !isQuoteTokenId(entry));
            return replace([...new Set(ids)], [...new Set(malformed)]);
          });
        })
        .join("");
    })
    .join("\n");
}

export function paragraphCitationIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  transformParagraphCitations(markdown, (group) => {
    for (const id of group) ids.add(id);
    return "";
  });
  return ids;
}

/**
 * Keep only citations with a record. Removed ids, unknown or malformed, are
 * reported through `onDroppedIds` so a caller can log what the reader lost.
 */
export function normalizeParagraphCitations(
  markdown: string,
  validIds: ReadonlySet<string>,
  onDroppedIds?: (ids: string[]) => void,
): string {
  return transformParagraphCitations(markdown, (ids, malformed) => {
    const known = ids.filter((id) => validIds.has(id));
    const dropped = [...ids.filter((id) => !validIds.has(id)), ...malformed];
    if (dropped.length) onDroppedIds?.(dropped);
    return known.length ? `[[cite:${known.join(",")}]]` : "";
  });
}
