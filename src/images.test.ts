import { expect, test } from "bun:test";
import { dimensions, sniff, stripMetadata } from "./images.ts";
import { jpegWithExif, png } from "./testing.ts";

test("type and size come from the bytes", () => {
  const p = png(300, 200);
  expect(sniff(p)).toBe("image/png");
  expect(dimensions(p, "image/png")).toEqual({ width: 300, height: 200 });
  const j = jpegWithExif(1024, 768);
  expect(sniff(j)).toBe("image/jpeg");
  expect(dimensions(j, "image/jpeg")).toEqual({ width: 1024, height: 768 });
  expect(sniff(new TextEncoder().encode("<svg>not an image</svg>"))).toBeNull();
});

test("EXIF is dropped from JPEG and PNG, the rest kept", () => {
  const j = stripMetadata(jpegWithExif(64, 48), "image/jpeg");
  expect(Buffer.from(j).includes("GPS-LOCATION")).toBe(false);
  expect(dimensions(j, "image/jpeg")).toEqual({ width: 64, height: 48 });
  const p = png(20, 20, [1, 2, 3], { type: "eXIf", data: new TextEncoder().encode("GPS-LOCATION") });
  const clean = stripMetadata(p, "image/png");
  expect(Buffer.from(clean).includes("GPS-LOCATION")).toBe(false);
  expect(clean.length).toBe(p.length - 12 - 12);
  expect(dimensions(clean, "image/png")).toEqual({ width: 20, height: 20 });
});
