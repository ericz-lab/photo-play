/** Small page tools: elements, icons, the API, toasts, the busy veil and the confirm dialog. */

import { ApiError, t } from "./i18n.ts";

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Markup to one element; used for the SVG icons, which `h` cannot make. */
function markup(html: string): Element {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild!;
}
export const icon = (id: string) => markup(`<svg class="icon" aria-hidden="true"><use href="#${id}" /></svg>`);
export const pad2 = (n: number) => String(n).padStart(2, "0");

/** JSON from the API; a refusal becomes an ApiError with the code the page translates. */
export async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: init.body && !(init.body instanceof Blob) ? { "content-type": "application/json", ...init.headers } : init.headers });
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || body.ok === false) throw new ApiError(body.error || `HTTP ${res.status}`, body.code, body.params);
  return body as T;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: "ok" | "error" = "ok") {
  const el = $("#toast");
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === "error" ? 6000 : 2500);
}

export function busy(text: string | null) {
  $("#busy").hidden = text === null;
  $("#busy-text").textContent = text ?? t("working");
}

/** A confirm in the page's own dialog. */
export function ask(title: string, text: string, yes: string): Promise<boolean> {
  const d = $<HTMLDialogElement>("#confirm");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-yes").textContent = yes;
  $("#confirm-no").textContent = t("cancel");
  return new Promise((resolve) => {
    const done = (v: boolean) => { d.close(); resolve(v); };
    $("#confirm-yes").onclick = () => done(true);
    $("#confirm-no").onclick = () => done(false);
    d.oncancel = () => resolve(false);
    d.showModal();
  });
}

/** A fresh idempotency key for one submission. */
export const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9-]/g, "").slice(0, 40);
