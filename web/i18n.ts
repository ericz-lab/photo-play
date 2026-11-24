/**
 * Every string the page shows, in Chinese and English (ai-space docs/app-spec.md#app-pages), the
 * language and theme controls, and the date formats. The inline script in index.html picks the
 * language (?lang, then the saved choice, then the browser) and the theme before the first paint.
 * Words people or the model wrote are shown as they are; errors from the API come as codes.
 */

const MESSAGES = {
  zh: {
    title: "旅行出片",
    language: "语言",
    theme_system: "主题：跟随系统",
    theme_light: "主题：浅色",
    theme_dark: "主题：深色",
    themeNext: "点击切换",
    works: "作品",
    filterByEffect: "按玩法筛选",
    allEffects: "全部玩法",
    uploadPhoto: "上传照片",
    newWork: "新的作品",
    noWorksWith: "还没有用「{name}」做过的作品。",
    noWorks: "还没有作品。上传第一张旅行照片吧。",
    worksFailed: "作品读取失败：{error}",
    retry: "重试",
    nVersions: "{n} 个版本",
    oneVersion: "1 个版本",
    originalPlusOne: "原图 + 1 个版本",
    nInProgress: " · {n} 张生成中",
    original: "原图",
    theOriginal: "原图",
    chooseTravelPhoto: "选择一张旅行照片",
    dropTravelPhoto: "把旅行照片拖到这里",
    pickTravelPhoto: "选一张旅行照片",
    choosePhoto: "选择照片",
    formats: "JPG、PNG、WebP 等常见格式 · 原图和每个版本都会保留",
    orPickEffect: "或先选个玩法",
    orPickEffectHint: "选好再挑照片，进来就用这个玩法",
    dropToUpload: "松手上传这张照片",
    sampleCardTitle: "布拉耶斯湖",
    sampleCardPlace: "多洛米蒂 · 2026.07.12",
    sampleHandTitle: "终于爬上来了！",
    sampleHandNote: "山顶的风",
    wipeSample: "{name}：拖动对比原图和效果",
    sampleAlt: "{name}的效果示例",
    before: "原图",
    after: "效果",
    startWith: "用「{name}」开始：选一张照片",
    preparing: "正在准备照片…",
    uploading: "正在上传…",
    working: "正在处理…",
    pictureNotLoaded: "图片加载失败",
    pictureUnreadable: "这张图片无法读取，请换成 JPEG 或 PNG",
    pictureTooLarge: "图片压缩后仍然过大",
    cannotOpen: "这个作品打不开：{error}",
    backToStart: "回到开始",
    compareBefore: "对比修改前",
    viewLarger: "放大查看",
    nameWork: "给作品起个名字",
    workName: "作品名称",
    renameWork: "重命名作品",
    saved: "已保存",
    deleteWorkQ: "删除这个作品？",
    deleteWorkText: "它的全部版本会一起删除；原图如果没有被别的作品使用，也会删除。",
    deleteWork: "删除作品",
    cancel: "取消",
    deleted: "已删除",
    preview: "作品预览",
    versions: "版本记录",
    editPanel: "编辑面板",
    version: "版本 {n}",
    queuedShowing: "排队第 {n} 位，先显示原图",
    startingShowing: "马上开始，先显示原图",
    generatingShowing: "正在生成，通常需要 1 到 3 分钟",
    failedShowing: "这一版没有生成出来，显示的是原图",
    unknownShowing: "这一版结果不明，显示的是原图",
    beforeEdit: "修改前",
    wipeStage: "拖动对比修改前后",
    keptAsIs: "保留底片",
    queued: "排队第 {n} 位",
    running: "生成中",
    done: "已完成",
    failed: "失败",
    unknown: "待核对",
    fromSource: "来自{source}",
    originalPlus: "原图 + {n} 个版本",
    originalOnly: "只有原图",
    versionInfo: "版本信息",
    size: "尺寸",
    uploaded: "上传于",
    downloadOriginal: "下载原图",
    editOriginal: "从原图修改",
    noVersionsYet: "还没有版本。在下面选一个玩法，生成第一张。",
    effectParams: "玩法参数",
    madeFrom: "来源",
    took: "用时",
    minSec: "{m} 分 {s} 秒",
    model: "模型",
    cost: "费用",
    costUnknownLedger: "未知（账本 #{id}）",
    costUnknown: "未知",
    tokens: "{in} 输入 / {out} 输出",
    alsoAsked: "补充要求",
    oneAtATime: "服务器一次做一张，通常 1 到 3 分钟；关掉页面也不影响，做好会出现在版本记录里。",
    retryUnknown: "确认没有生成，手动重试",
    downloadFinished: "下载成品",
    withoutWords: "不带文字",
    download: "下载",
    continueFrom: "从此版本继续改",
    bottom: "下方",
    top: "上方",
    titleTopLeft: "标题在左上",
    titleBottomRight: "标题在右下",
    wordsPosition: "文字位置",
    fontSize: "字号",
    wordsLayer: "文字层",
    wordsFree: "改字不用重新生成",
    position: "位置",
    setByPage: " · 页面排版，之后可改",
    extraPlaceholder: "可选：再补充一句要求",
    submitting: "提交中…",
    makeVersion: "生成新版本",
    submitted: "已提交，生成完成后会自动显示",
    startFrom: "基于",
    thisVersion: "当前版本",
    newEdit: "新的修改",
    onePicture: "输出 1 张",
    effect: "玩法",
    alsoAsk: "补充要求",
    costHint: "费用未知（走 ai-space 的模型额度）· 原图和旧版本都会保留",
    notReadyForm: "生成服务未接入，暂时不能生成（见页面顶部）",
    versionReady: "{v} 生成好了",
    versionFailed: "{v} 生成失败",
    close: "关闭",
    noticeTitle: "暂时不能生成新版本",
    noticeText: "{reason}。作品、改字和下载照常可用。",
    serviceDown: "服务不可用：{error}",
    "reason.not_connected": "未接入 ai-space（缺少 SPACE_API_URL 或 SPACE_APP_TOKEN）",
    "reason.not_ready": "生成服务暂时不可用",
    "error.image_type": "只支持 JPEG、PNG 或 WebP 图片",
    "error.image_size": "读不出图片尺寸，文件可能已损坏",
    "error.artwork_not_found": "作品不存在",
    "error.artwork_busy": "还有版本在生成，完成后再删除",
    "error.picture_not_found": "图片不存在",
    "error.job_not_found": "任务不存在",
    "error.bad_id": "id 不正确",
    "error.missing_key": "缺少提交标识",
    "error.no_template": "没有这个玩法",
    "error.base_other_artwork": "基础版本不属于这个作品",
    "error.base_not_done": "基础版本还没有生成成功",
    "error.not_connected": "未接入 ai-space，暂时无法生成",
    "error.not_ready": "暂时无法生成",
    "error.extra_length": "补充要求最多 {max} 个字",
    "error.no_picture": "没有收到图片",
    "error.picture_too_large": "图片超过 {mb} MB",
    "error.thumb_of_thumb": "缩略图不能再有缩略图",
    "error.thumb_size": "缩略图大小不合适",
    "error.upload_first": "请先上传一张照片",
    "error.bad_title": "名称应为文字",
    "error.not_retryable": "只有失败或待核对的任务可以重试",
    "error.no_overlay": "这个玩法没有文字排版",
    "error.bad_json": "请求格式不对",
    "error.param_choice": "{label}：不是可选的值",
    "error.param_range": "{label}：应在 {min} 到 {max} 之间",
    "error.param_length": "{label}：最多 {max} 个字",
    "error.param_required": "请填写{label}",
    "error.internal": "服务出错了",
  },
  en: {
    title: "PhotoPlay",
    language: "Language",
    theme_system: "Theme: system",
    theme_light: "Theme: light",
    theme_dark: "Theme: dark",
    themeNext: "click to change",
    works: "Works",
    filterByEffect: "Filter by effect",
    allEffects: "All effects",
    uploadPhoto: "Upload photo",
    newWork: "New work",
    noWorksWith: "No works with {name} yet.",
    noWorks: "No works yet. Upload your first travel photo.",
    worksFailed: "The works did not load: {error}",
    retry: "Retry",
    nVersions: "{n} versions",
    oneVersion: "1 version",
    originalPlusOne: "Original + 1 version",
    nInProgress: " · {n} in progress",
    original: "Original",
    theOriginal: "the original",
    chooseTravelPhoto: "Choose a travel photo",
    dropTravelPhoto: "Drop a travel photo here",
    pickTravelPhoto: "Choose a travel photo",
    choosePhoto: "Choose photo",
    formats: "JPG, PNG, WebP and other common formats · the original and every version are kept",
    orPickEffect: "Or pick an effect first",
    orPickEffectHint: "Then choose a photo; the editor opens with that effect",
    dropToUpload: "Drop to upload this photo",
    sampleCardTitle: "Lago di Braies",
    sampleCardPlace: "Dolomites · 2026.07.12",
    sampleHandTitle: "Made it to the top!",
    sampleHandNote: "summit wind",
    wipeSample: "{name}: drag to compare the original and the result",
    sampleAlt: "{name} example",
    before: "Before",
    after: "After",
    startWith: "Start with {name}: choose a photo",
    preparing: "Preparing the photo…",
    uploading: "Uploading…",
    working: "Working…",
    pictureNotLoaded: "The picture did not load",
    pictureUnreadable: "This picture cannot be read; try a JPEG or PNG",
    pictureTooLarge: "The picture is still too large after compressing",
    cannotOpen: "This work cannot be opened: {error}",
    backToStart: "Back to start",
    compareBefore: "Compare with before",
    viewLarger: "View larger",
    nameWork: "Name this work",
    workName: "Work name",
    renameWork: "Rename work",
    saved: "Saved",
    deleteWorkQ: "Delete this work?",
    deleteWorkText: "All its versions go with it, and the original too unless another work uses it.",
    deleteWork: "Delete work",
    cancel: "Cancel",
    deleted: "Deleted",
    preview: "Preview",
    versions: "Versions",
    editPanel: "Edit panel",
    version: "Version {n}",
    queuedShowing: "No. {n} in the queue; showing the original",
    startingShowing: "Starting now; showing the original",
    generatingShowing: "Generating, usually 1 to 3 minutes",
    failedShowing: "This version was not made; showing the original",
    unknownShowing: "This version's result is unknown; showing the original",
    beforeEdit: "Before",
    wipeStage: "Drag to compare before and after",
    keptAsIs: "kept as is",
    queued: "No. {n} in the queue",
    running: "Generating",
    done: "Done",
    failed: "Failed",
    unknown: "To check",
    fromSource: "from {source}",
    originalPlus: "Original + {n} versions",
    originalOnly: "Original only",
    versionInfo: "Version",
    size: "Size",
    uploaded: "Uploaded",
    downloadOriginal: "Download original",
    editOriginal: "Edit the original",
    noVersionsYet: "No versions yet. Pick an effect below to make the first one.",
    effectParams: "Effect",
    madeFrom: "Made from",
    took: "Took",
    minSec: "{m} min {s} s",
    model: "Model",
    cost: "Cost",
    costUnknownLedger: "unknown (ledger #{id})",
    costUnknown: "unknown",
    tokens: "{in} in / {out} out",
    alsoAsked: "Also asked",
    oneAtATime: "The server makes one at a time, usually in 1 to 3 minutes; closing the page is fine, the result appears in Versions.",
    retryUnknown: "Not made? Retry by hand",
    downloadFinished: "Download",
    withoutWords: "Without words",
    download: "Download",
    continueFrom: "Continue from this version",
    bottom: "Bottom",
    top: "Top",
    titleTopLeft: "Title top left",
    titleBottomRight: "Title bottom right",
    wordsPosition: "Words position",
    fontSize: "Size",
    wordsLayer: "Words",
    wordsFree: "Editing words makes no new picture",
    position: "Position",
    setByPage: " · set by the page, editable later",
    extraPlaceholder: "Optional: anything else to ask",
    submitting: "Submitting…",
    makeVersion: "Make a new version",
    submitted: "Submitted; it shows up here when done",
    startFrom: "Start from",
    thisVersion: "This version",
    newEdit: "New edit",
    onePicture: "1 picture",
    effect: "Effect",
    alsoAsk: "Also ask",
    costHint: "Cost unknown (the Space's model quota) · the original and earlier versions are kept",
    notReadyForm: "Generating is not available now (see the top of the page)",
    versionReady: "{v} is ready",
    versionFailed: "{v} failed",
    close: "Close",
    noticeTitle: "New versions are unavailable",
    noticeText: "{reason}. Works, words and downloads still work.",
    serviceDown: "The service is unavailable: {error}",
    "reason.not_connected": "Not connected to ai-space (SPACE_API_URL or SPACE_APP_TOKEN is missing)",
    "reason.not_ready": "Generating is unavailable for now",
    "error.image_type": "Only JPEG, PNG or WebP pictures",
    "error.image_size": "The picture's size cannot be read; the file may be damaged",
    "error.artwork_not_found": "No such work",
    "error.artwork_busy": "A version is still being made; delete it after that",
    "error.picture_not_found": "No such picture",
    "error.job_not_found": "No such job",
    "error.bad_id": "Not a valid id",
    "error.missing_key": "The submission key is missing",
    "error.no_template": "No such effect",
    "error.base_other_artwork": "That version belongs to another work",
    "error.base_not_done": "That version was not made",
    "error.not_connected": "Not connected to ai-space; generating is unavailable",
    "error.not_ready": "Generating is unavailable for now",
    "error.extra_length": "At most {max} characters",
    "error.no_picture": "No picture received",
    "error.picture_too_large": "The picture is over {mb} MB",
    "error.thumb_of_thumb": "A thumbnail has no thumbnail",
    "error.thumb_size": "The thumbnail is the wrong size",
    "error.upload_first": "Upload a photo first",
    "error.bad_title": "The name must be text",
    "error.not_retryable": "Only a failed or unconfirmed job can be retried",
    "error.no_overlay": "This effect has no words layer",
    "error.bad_json": "The request is malformed",
    "error.param_choice": "{label}: not one of the choices",
    "error.param_range": "{label}: between {min} and {max}",
    "error.param_length": "{label}: at most {max} characters",
    "error.param_required": "{label} is required",
    "error.internal": "Something went wrong on the server",
  },
} as const;

export type Lang = keyof typeof MESSAGES;
export type Key = keyof (typeof MESSAGES)["en"];
/** Words in both languages, as the API sends a template's. */
export type Text = { zh: string; en: string };
type Theme = "system" | "light" | "dark";
type Vars = Record<string, string | number>;

const root = document.documentElement;
const LANG_KEY = "photo-play.lang";
const THEME_KEY = "photo-play.theme";
const save = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* private mode: the choice lasts this visit */ }
};

export let lang: Lang = root.lang.startsWith("zh") ? "zh" : "en";
let theme: Theme = (root.dataset.theme as Theme | undefined) ?? "system";
// A ?lang from the panel sticks, so the page opened later on its own keeps it.
if (new URLSearchParams(location.search).get("lang")) save(LANG_KEY, lang);

export function t(key: Key, vars: Vars = {}): string {
  const s: string = MESSAGES[lang][key] ?? MESSAGES.en[key];
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** A template's words in the page language. */
export const tx = (text: Text | undefined): string => (text ? text[lang] : "");

const locale = () => (lang === "zh" ? "zh-CN" : "en");
export const when = (iso: string) => new Date(iso).toLocaleString(locale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const num = (n: number) => n.toLocaleString(locale());

/** "3 versions", with the singular. */
export const versionsText = (n: number) => (n === 1 ? t("oneVersion") : t("nVersions", { n }));

/** "Version 03": the number the strip shows. */
export const versionLabel = (n: number) => t("version", { n: String(n).padStart(2, "0") });

/** An error from the API, by its code; anything else (the network, ai-space, the model) as it came. */
export class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly params: Vars = {}) {
    super(message);
  }
}

/** Names a parameter in an error: the API sends its key, the page knows its label. */
let labelOf: (param: string) => string = (p) => p;
export const setParamLabels = (f: (param: string) => string) => { labelOf = f; };

export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code) {
    const key = `error.${e.code}` as Key;
    if (key in MESSAGES.en) return t(key, { ...e.params, label: labelOf(String(e.params.param ?? "")) });
  }
  return e instanceof Error ? e.message : String(e);
}

export function reasonText(code: string | null): string {
  const key = `reason.${code ?? "not_ready"}` as Key;
  return key in MESSAGES.en ? t(key) : (code ?? t("reason.not_ready"));
}

const ICONS: Record<Theme, string> = {
  system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
};

/** The fixed text in index.html (`data-i18n`, `data-i18n-label`) and both controls. */
function paint() {
  root.lang = locale();
  document.title = t("title");
  document.body.dataset.drop = t("dropToUpload");
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n as Key);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel as Key));
  const langs = document.querySelector<HTMLElement>("#langs")!;
  langs.setAttribute("aria-label", t("language"));
  for (const b of langs.querySelectorAll<HTMLElement>("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
  const button = document.querySelector<HTMLButtonElement>("#theme")!;
  button.title = `${t(`theme_${theme}`)} (${t("themeNext")})`;
  button.setAttribute("aria-label", button.title);
  button.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[theme]}</svg>`;
}

/** Wires the 中 / EN switch and the theme button; `onLang` redraws what the app drew. */
export function setupPrefs(onLang: () => void) {
  document.querySelector("#langs")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-lang]");
    if (!b || b.dataset.lang === lang) return;
    lang = b.dataset.lang as Lang;
    save(LANG_KEY, lang);
    paint();
    onLang();
  });
  document.querySelector("#theme")!.addEventListener("click", () => {
    theme = ({ system: "light", light: "dark", dark: "system" } as const)[theme];
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    save(THEME_KEY, theme);
    paint();
  });
  paint();
}
