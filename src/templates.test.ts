import { expect, test } from "bun:test";
import { buildPrompt, cleanParams, overlayOf, publicTemplates, template, TEMPLATES } from "./templates.ts";

test("every template builds a prompt from its defaults that forbids lettering", () => {
  for (const t of TEMPLATES) {
    const params = cleanParams(t, t.id === "free" ? { instruction: "把阴天改成晴天" } : {});
    const prompt = buildPrompt(t, params, "");
    expect(prompt).toContain("img1");
    expect(prompt).toContain("Do not add any text");
  }
});

test("parameters are checked against the template", () => {
  const light = template("light")!;
  expect(cleanParams(light, { tone: "film", strength: "3", junk: 1 })).toEqual({ tone: "film", strength: 3 });
  expect(() => cleanParams(light, { tone: "neon" })).toThrow("tone");
  expect(() => cleanParams(light, { strength: 9 })).toThrow("strength");
  expect(() => cleanParams(template("free")!, {})).toThrow("required");
  expect(() => cleanParams(template("postcard")!, { title: "长".repeat(30) })).toThrow("at most");
});

test("overlay words stay out of the prompt", () => {
  const t = template("postcard")!;
  const params = cleanParams(t, { title: "京都的秋天", place: "岚山", date: "2026.10.03" });
  expect(overlayOf(t, params)).toEqual({ title: "京都的秋天", place: "岚山", date: "2026.10.03" });
  const prompt = buildPrompt(t, params, "天空再蓝一点");
  expect(prompt).not.toContain("京都");
  expect(prompt).toContain("Also: 天空再蓝一点");
  expect(publicTemplates().every((x) => !("prompt" in x))).toBe(true);
});
