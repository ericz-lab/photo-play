/**
 * The page, one screen: the works on the left (side.ts); on the right the start screen
 * (start.ts) or the editor of one artwork (editor.ts). Hash routes, no framework. Every string
 * comes from i18n.ts, which also holds the 中 / EN switch and the theme button.
 */

import { $, h, icon } from "./dom.ts";
import { reasonText, setParamLabels, setupPrefs, t, tx } from "./i18n.ts";
import { renderEditor } from "./editor.ts";
import { renderSide } from "./side.ts";
import { renderStart, setupDrop } from "./start.ts";
import { app, type Template } from "./state.ts";

const view = $("#view");

async function route() {
  app.stopPolling?.();
  $("#lightbox").hidden = true;
  const parts = location.hash.replace(/^#/, "").split("?")[0]!.split("/").filter(Boolean);
  const id = parts[0] === "a" && Number(parts[1]) ? Number(parts[1]) : null;
  if (parts.length && !id) history.replaceState(null, "", "#/");
  app.openId = id;
  void renderSide();
  window.scrollTo(0, 0);
  if (id) return renderEditor(view, id);
  return renderStart(view);
}

function drawNotice() {
  const n = $("#notice");
  n.hidden = app.status.ready;
  if (!app.status.ready) n.replaceChildren(icon("i-info"), h("span", {}, h("strong", {}, t("noticeTitle")), " ", t("noticeText", { reason: reasonText(app.status.reason) })));
}

async function boot() {
  $("#logo").append(h("img", { src: "/icon.svg", alt: "" }));
  // A language change redraws what the app drew; what was typed in the editor's form is let go.
  setupPrefs(() => { drawNotice(); void route(); });
  setupDrop();
  setParamLabels((key) => {
    for (const x of app.templates) for (const p of x.params) if (p.key === key) return tx(p.label);
    return key;
  });
  try {
    const [tl, s] = await Promise.all([
      fetch("/api/templates").then((r) => r.json() as Promise<{ templates: Template[] }>),
      fetch("/api/status").then((r) => r.json() as Promise<{ ready: boolean; reason: string | null }>),
    ]);
    app.templates = tl.templates;
    app.status = s;
  } catch (e) {
    view.replaceChildren(h("p", { class: "error pad" }, t("serviceDown", { error: (e as Error).message })));
    return;
  }
  drawNotice();
  addEventListener("hashchange", () => void route());
  await route();
}

void boot();
