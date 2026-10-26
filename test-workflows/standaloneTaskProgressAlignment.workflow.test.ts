import { assert } from "chai";
import type { WorkflowTestApi } from "../src/modules/contextPanel/workflowTestTypes";

// In the standalone window the chat's header rows line up with the History
// pane's rows: the title row with New chat, and the Task progress row with
// Search history. These read the laid-out boxes of both columns.
describe("workflow: standalone Task progress lines up with the History pane", function () {
  this.timeout(120000);
  const prefs: Array<[string, unknown]> = [
    ["extensions.zotero.llmforzotero.enableAgentMode", true],
    ["extensions.zotero.llmforzotero.lastUsedRuntimeMode", "agent"],
  ];
  const saved = new Map<string, unknown>();
  let api: WorkflowTestApi;
  let paper: Awaited<ReturnType<WorkflowTestApi["createPaperWithPdfFixture"]>>;

  async function until(check: () => boolean, message: string) {
    const deadline = Date.now() + 15000;
    while (!check() && Date.now() < deadline) await Zotero.Promise.delay(25);
    assert.isTrue(check(), message);
  }

  before(async function () {
    assert.include(Zotero.DataDirectory.dir, ".scaffold/test/data");
    api = (Zotero as any).LLMForZotero.api.workflowTest;
    await api.reset();
    for (const [name, value] of prefs) {
      saved.set(name, Zotero.Prefs.get(name, true));
      Zotero.Prefs.set(name, value as never, true);
    }
    paper = await api.createPaperWithPdfFixture({
      title: "Place cells in a familiar arena",
      pdfTitle: "Place cells in a familiar arena",
      pages: ["Place cell evidence."],
    });
  });

  after(async function () {
    await api.closeStandalone().catch(() => undefined);
    await api.reset();
    if (paper) await api.cleanupFixture(paper);
    for (const [name, value] of saved) {
      if (value === undefined) Zotero.Prefs.clear(name, true);
      else Zotero.Prefs.set(name, value as never, true);
    }
  });

  for (const tab of ["open", "paper"] as const) {
    it(`centres the rows on the History pane's rows (${tab === "open" ? "Library" : "Paper"} chat)`, async function () {
      await api.openStandaloneForItem(paper.parentItemId);
      await api.resizeStandaloneWindow(900, 760);
      await api.clickStandaloneTab(tab);
      const win = (Zotero as any).LLMForZotero.data.standaloneWindow;
      const doc = win.document as Document;
      const root = () =>
        doc.querySelector(".llm-standalone-content #llm-main") as HTMLElement;
      await until(
        () =>
          root()?.dataset.conversationKind ===
          (tab === "open" ? "global" : "paper"),
        `the window shows the ${tab} chat`,
      );
      const curtain = () =>
        root().querySelector(".llm-task-progress-curtain") as HTMLElement;
      if (curtain().dataset.curtain !== "open") {
        (
          doc.querySelector(
            ".llm-standalone-content-title-actions .llm-standalone-icon-task-progress",
          ) as HTMLButtonElement
        ).click();
      }
      await until(() => {
        api.flushTaskProgress();
        return curtain().dataset.curtain === "open";
      }, "the Task progress row is down");
      await Zotero.Promise.delay(100);

      const navRows = (
        Array.from(
          doc.querySelectorAll(".llm-standalone-primary-nav button"),
        ) as HTMLElement[]
      ).filter((button) => button.getBoundingClientRect().height > 0);
      const [newChat, search] = navRows.map((button) =>
        button.getBoundingClientRect(),
      );
      const title = doc
        .querySelector(
          ".llm-standalone-content-wrapper > .llm-standalone-content-title",
        )!
        .getBoundingClientRect();
      const row = (
        root().querySelector("#llm-task-progress") as HTMLElement
      ).getBoundingClientRect();
      const mid = (rect: DOMRect) => (rect.top + rect.bottom) / 2;

      assert.closeTo(
        mid(title),
        mid(newChat),
        0.5,
        "the title row is centred on New chat",
      );
      assert.closeTo(
        mid(row),
        mid(search),
        0.5,
        "the Task progress row is centred on Search history",
      );
      assert.closeTo(
        row.height,
        search.height,
        0.5,
        "the Task progress row is as tall as Search history",
      );
    });
  }
});
