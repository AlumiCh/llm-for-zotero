import { assert } from "chai";
import {
  buildQuoteCitation,
  selectUsedQuoteCitations,
  finalizeAssistantQuoteCitations,
} from "../src/services/quotes/quoteCitations";
import {
  buildQuoteRenderPlan,
  buildQuoteExpandedMarkdown,
} from "../src/modules/contextPanel/quoteRenderPlan";
import {
  paragraphCitationIds,
  normalizeParagraphCitations,
} from "../src/services/quotes/paragraphCitations";

const a = buildQuoteCitation({
  quoteText:
    "The methods measured neural activity across twelve recording sessions in five animals.",
  citationLabel: "(Kim, 2026)",
  contextItemId: 21,
  itemId: 20,
  sourceMatchText:
    "The methods measured neural activity across twelve recording sessions in five animals.",
  sourceMatchKind: "exact",
  sourceMatchSource: "context-text",
})!;
const b = buildQuoteCitation({
  ...a,
  id: undefined,
  citationLabel: "(Lee, 2025)",
  contextItemId: 31,
  itemId: 30,
})!;

describe("paragraph evidence citations", function () {
  it("keeps a multi-source paragraph compact and a separate reading recommendation visible", function () {
    const text = `The experiments recorded multiple sessions. [[cite:${a.id},${b.id},${a.id}]]\n\nRead this passage for the protocol:\n\n[[quote:${a.id}]]`;
    const plan = buildQuoteRenderPlan({
      markdown: text,
      quoteCitations: [a, b],
    });
    assert.lengthOf(plan.occurrences, 1);
    assert.lengthOf(plan.paragraphCitations, 1);
    assert.deepEqual(
      plan.paragraphCitations[0].map((citation) => citation.id),
      [a.id, b.id],
    );
    assert.include(plan.displayMarkdown, "sessions. LLMPAPERCITE0END");
    assert.deepEqual(
      selectUsedQuoteCitations({ text, quoteCitations: [a, b] }),
      [a, b],
    );
    const expanded = buildQuoteExpandedMarkdown({
      markdown: text,
      quoteCitations: [a, b],
    });
    assert.include(expanded, b.citationLabel);
    assert.notInclude(expanded, "LLMPAPERCITE");
    assert.notInclude(expanded, "[[cite:");
  });

  it("persists inline-only evidence through quote finalization and drops invented IDs", function () {
    const finalized = finalizeAssistantQuoteCitations({
      markdown: `This protocol spans multiple sessions. [[cite:${a.id},invented]]`,
      quoteCitations: [a, b],
    });
    assert.deepEqual(
      finalized.quoteCitations.map((citation) => citation.id),
      [a.id],
    );
    assert.include(finalized.markdown, `[[cite:${a.id}]]`);
    assert.notInclude(finalized.markdown, "invented");
  });

  it("does not expose malformed or made-up citation markers", function () {
    const plan = buildQuoteRenderPlan({
      markdown: "Claim. [[cite:chunk 0]] [[cite:bad?]]",
      quoteCitations: [a],
    });
    assert.isEmpty(plan.paragraphCitations);
    assert.notInclude(plan.displayMarkdown, "[[cite:");
  });

  it("leaves code examples and escaped markers literal, combines adjacent footers, and strips unknown evidence", function () {
    const text = `Example \`[[cite:${a.id}]]\`\n\n\`\`\`text\n[[cite:${b.id}]]\n\`\`\`\n\nA claim. [[cite:${a.id}]] [[cite:${b.id}]]\n\nUnknown. [[cite:invented]]`;
    const plan = buildQuoteRenderPlan({
      markdown: text,
      quoteCitations: [a, b],
    });
    assert.lengthOf(plan.paragraphCitations, 1);
    assert.lengthOf(plan.paragraphCitations[0], 2);
    assert.notInclude(plan.displayMarkdown, "invented");
    assert.include(plan.displayMarkdown, `\`[[cite:${a.id}]]\``);
    assert.isEmpty(paragraphCitationIds(`\\[[cite:${a.id}]]`));
    assert.equal(
      normalizeParagraphCitations("No source. [[cite:bad]]", new Set()),
      "No source. ",
    );
    assert.equal(
      normalizeParagraphCitations("x [[cite:bad id]]", new Set([a.id])),
      "x ",
    );
  });
  it("keeps paragraph citation ids that contain '.' or ':'", function () {
    assert.deepEqual(
      [...paragraphCitationIds("A claim. [[cite:x.y, p:1]] [[cite:bad?]]")],
      ["x.y", "p:1"],
    );
    assert.equal(
      normalizeParagraphCitations(
        "A claim. [[cite:x.y,p:1]]",
        new Set(["p:1"]),
      ),
      "A claim. [[cite:p:1]]",
    );
  });

  it("keeps every id of a semicolon- or space-separated citation list", function () {
    // Live failure: [[cite:A;B]] was read as one malformed id, so both valid
    // passages vanished from the paragraph footer.
    for (const separator of [";", "; ", " ", ",;"]) {
      const markdown = `Drift is slow. [[cite:${a.id}${separator}${b.id}]]`;
      assert.deepEqual(
        [...paragraphCitationIds(markdown)],
        [a.id, b.id],
        separator,
      );
      const plan = buildQuoteRenderPlan({
        markdown,
        quoteCitations: [a, b],
      });
      assert.deepEqual(
        plan.paragraphCitations[0]?.map((citation) => citation.id),
        [a.id, b.id],
        separator,
      );
      assert.equal(
        normalizeParagraphCitations(markdown, new Set([a.id, b.id])),
        `Drift is slow. [[cite:${a.id},${b.id}]]`,
        separator,
      );
    }
    const finalized = finalizeAssistantQuoteCitations({
      markdown: `This protocol spans multiple sessions. [[cite:${a.id};${b.id}]]`,
      quoteCitations: [a, b],
    });
    assert.deepEqual(
      finalized.quoteCitations.map((citation) => citation.id),
      [a.id, b.id],
    );
  });

  it("records removed unknown citation ids instead of dropping them silently", function () {
    const plan = buildQuoteRenderPlan({
      markdown: `A claim. [[cite:${a.id},Q_20_dummy]]\n\nAnother. [[cite:bad?]]`,
      quoteCitations: [a],
    });
    assert.deepEqual(
      plan.paragraphCitations.map((group) => group.map((c) => c.id)),
      [[a.id]],
    );
    assert.notInclude(plan.displayMarkdown, "Q_20_dummy");
    assert.notInclude(plan.displayMarkdown, "bad?");
    assert.deepEqual(
      plan.diagnostics
        .filter((entry) => entry.kind === "unresolved-anchor")
        .map((entry) => entry.quoteCitationId),
      ["Q_20_dummy", "bad?"],
    );
    const dropped: string[] = [];
    assert.equal(
      normalizeParagraphCitations(
        `A claim. [[cite:${a.id};Q_20_dummy]]`,
        new Set([a.id]),
        (ids) => dropped.push(...ids),
      ),
      `A claim. [[cite:${a.id}]]`,
    );
    assert.deepEqual(dropped, ["Q_20_dummy"]);
  });
});
