/** The works, always on the left: a filter by effect, upload, and one row per artwork. */

import { $, api, h, icon } from "./dom.ts";
import { errorText, t, tx, versionsText, when } from "./i18n.ts";
import { app, type ArtworkView, thumb, tpl } from "./state.ts";
import { openPicker } from "./start.ts";

const side = $("#side");
/** The effect the works list is filtered by; null: all. */
let filterBy: string | null = null;
/** Only the newest render fills the list. */
let seq = 0;

export async function renderSide() {
  const mine = ++seq;
  const filter = h("select", { "aria-label": t("filterByEffect") },
    h("option", { value: "", selected: !filterBy }, t("allEffects")),
    ...app.templates.map((x) => h("option", { value: x.id, selected: filterBy === x.id }, tx(x.name)))) as HTMLSelectElement;
  filter.addEventListener("change", () => { filterBy = filter.value || null; void renderSide(); });
  const list = h("div", { class: "side-list" }, ...[0, 1, 2].map(() => h("div", { class: "skeleton side-skel" })));
  const count = h("small", {});
  side.setAttribute("aria-label", t("works"));
  side.replaceChildren(
    h("div", { class: "side-head" }, h("div", { class: "row" }, h("h2", {}, t("works")), count), filter),
    h("button", { class: "primary upload-btn", type: "button", onclick: () => openPicker() }, icon("i-up"), t("uploadPhoto")),
    h("a", { class: `side-new${app.openId === null ? " on" : ""}`, href: "#/" }, icon("i-plus"), t("newWork")),
    list,
  );
  try {
    const { artworks } = await api<{ artworks: ArtworkView[] }>(`/api/artworks${filterBy ? `?template=${filterBy}` : ""}`);
    if (mine !== seq) return;
    count.textContent = String(artworks.length);
    const empty = filterBy ? t("noWorksWith", { name: tx(tpl(filterBy)?.name) || filterBy }) : t("noWorks");
    list.replaceChildren(...(artworks.length ? artworks.map(item) : [h("p", { class: "side-empty" }, empty)]));
  } catch (e) {
    if (mine !== seq) return;
    list.replaceChildren(h("div", { class: "side-empty error" }, t("worksFailed", { error: errorText(e) }), h("br"),
      h("button", { type: "button", onclick: () => void renderSide() }, icon("i-retry"), t("retry"))));
  }
}

function item(a: ArtworkView): HTMLElement {
  return h("a", { class: "item", href: `#/a/${a.id}`, "aria-current": app.openId === a.id ? "page" : null },
    h("img", { src: thumb(a.cover), alt: "", loading: "lazy" }),
    h("span", { class: "item-copy" },
      h("strong", {}, a.title || when(a.createdAt)),
      h("small", {}, a.versions ? versionsText(a.versions) : t("original"), a.pending ? h("span", { class: "busy-mark" }, t("nInProgress", { n: a.pending })) : null),
    ),
  );
}
