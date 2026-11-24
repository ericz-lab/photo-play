# Effect samples

The before/after pictures on the start screen. Each "before" is an open-licence photo (CC0 or public domain, found through Openverse); each "after" is one real run of that effect: `POST /api/model/image` on an ai-space as the photo-play app, tag = template id, model `codex/intermediate`, prompt = the template's own `prompt()` with the parameters below. Both are cropped to 960×720. The words on the postcard and notes samples are drawn by the page, as in the editor.

| effect | before (source, licence) | parameters | run |
|---|---|---|---|
| cleanup | "Shibuya crossing, Japan tourist destination", rawpixel, CC0 — https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDIyLTExL3B4OTAwMzM4LWltYWdlLmpwZw.jpg | target people, keep 街道、建筑和招牌 | 2026-11-23, call #244 |
| light | "Fort mountain lake 02", Wikimedia Commons, CC0 — https://commons.wikimedia.org/wiki/File:Fort_mountain_lake_02.JPG | tone golden, strength 3 | 2026-11-23, call #245 |
| postcard | "Boathouse on a mountain lake (Unsplash)", Wikimedia Commons, CC0 — https://commons.wikimedia.org/wiki/File:Boathouse_on_a_mountain_lake_(Unsplash).jpg | style vintage | 2026-11-23, call #241 |
| annotate | "Two Hikers climbing Flattop Mountain (22204020976)", Wikimedia Commons, CC0 — https://commons.wikimedia.org/wiki/File:Two_Hikers_climbing_Flattop_Mountain_(22204020976).jpg | amount 2 | 2026-11-23, call #242 |
| free | "Phnom Penh Night Market", Wikimedia Commons, CC0 — https://commons.wikimedia.org/wiki/File:Phnom_Penh_Night_Market.jpg | 让夜市更有电影感：暖黄的灯光，青色的阴影，轻微的胶片颗粒，保留人物和摊位 | 2026-11-23, call #243 |

Call numbers are in the Mac ai-space's model ledger.
