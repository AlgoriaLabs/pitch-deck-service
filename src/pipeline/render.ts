// Renders an outline + repository facts into a 10-slide 16:9 PPTX with pptxgenjs.
// One fixed theme for v1. Text sizes are chosen for the outline's length limits (outline.ts), so
// nothing overflows. All shapes are native PowerPoint shapes: the deck stays fully editable.

import PptxGenJSModule from "pptxgenjs";
import type { RepoFacts } from "./digest.js";
import type { Outline } from "./outline.js";

const W = 13.333;
const H = 7.5;
const M = 0.7; // side margin
const FONT = "Calibri";
const C = {
  ink: "1B1F3B",
  inkSoft: "2A2F55",
  paper: "FAFAF7",
  card: "FFFFFF",
  line: "E3E3DC",
  text: "1B1F3B",
  muted: "5D6280",
  accent: "FF6B4A",
  accentSoft: "FFE7E0",
  accent2: "3D5AFE",
  onInk: "FFFFFF",
  onInkMuted: "B9BCD6",
};

// pptxgenjs ships CommonJS-style typings without "type": "module": unwrap the default export for both
// the type checker and Node's ESM loader.
type PptxGenJS = InstanceType<typeof PptxGenJSModule.default>;
type Slide = ReturnType<PptxGenJS["addSlide"]>;
const PptxGen = ((PptxGenJSModule as unknown as { default?: unknown }).default ?? PptxGenJSModule) as typeof PptxGenJSModule.default;

export async function renderDeck(outline: Outline, facts: RepoFacts): Promise<{ buffer: Buffer; slideCount: number; title: string }> {
  const pptx = new PptxGen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `${outline.projectName} — pitch deck`;
  pptx.subject = outline.tagline;
  pptx.company = facts.fullName;
  pptx.author = "pitch-deck-agent";
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };

  pptx.defineSlideMaster({ title: "CONTENT", background: { color: C.paper }, objects: [] });
  pptx.defineSlideMaster({ title: "DARK", background: { color: C.ink }, objects: [] });

  let n = 0;
  const content = (headline: string, kicker: string, notes: string): Slide => {
    n += 1;
    const slide = pptx.addSlide({ masterName: "CONTENT" });
    slide.addShape("rect", { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.accent }, line: { type: "none" } });
    slide.addText(kicker.toUpperCase(), { x: M, y: 0.45, w: 8, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0 });
    slide.addText(headline, { x: M, y: 0.75, w: W - 2 * M, h: 0.9, fontFace: FONT, fontSize: 32, bold: true, color: C.text, margin: 0, valign: "top" });
    slide.addText(`${outline.projectName}  ·  ${n}`, { x: W - M - 4, y: H - 0.5, w: 4, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, align: "right", margin: 0 });
    if (notes) slide.addNotes(notes);
    return slide;
  };

  // 1 — Title
  {
    n += 1;
    const s = pptx.addSlide({ masterName: "DARK" });
    s.addShape("rect", { x: M, y: 2.2, w: 0.9, h: 0.08, fill: { color: C.accent }, line: { type: "none" } });
    s.addText(outline.projectName, { x: M, y: 2.45, w: W - 2 * M, h: 1.4, fontFace: FONT, fontSize: 60, bold: true, color: C.onInk, margin: 0, fit: "shrink" });
    s.addText(outline.tagline, { x: M, y: 3.95, w: 10, h: 1.0, fontFace: FONT, fontSize: 24, color: C.onInkMuted, margin: 0, valign: "top" });
    s.addText(facts.url, { x: M, y: H - 1.0, w: 8, h: 0.3, fontFace: FONT, fontSize: 12, color: C.onInkMuted, margin: 0, hyperlink: { url: facts.url } });
    s.addText(`commit ${facts.sha.slice(0, 7)}`, { x: W - M - 3, y: H - 1.0, w: 3, h: 0.3, fontFace: FONT, fontSize: 12, color: C.onInkMuted, align: "right", margin: 0 });
  }

  // 2 — Problem, 3 — Solution
  bulletSlide(content(outline.problem.headline, "The problem", outline.problem.notes), outline.problem.bullets, C.accent);
  bulletSlide(content(outline.solution.headline, "The solution", outline.solution.notes), outline.solution.bullets, C.accent2);

  // 4 — How it works: numbered steps with chevrons
  {
    const s = content(outline.howItWorks.headline, "How it works", outline.howItWorks.notes);
    const steps = outline.howItWorks.steps;
    const gap = 0.45;
    const w = (W - 2 * M - gap * (steps.length - 1)) / steps.length;
    steps.forEach((step, i) => {
      const x = M + i * (w + gap);
      card(s, x, 2.2, w, 3.6);
      s.addShape("ellipse", { x: x + 0.35, y: 2.55, w: 0.7, h: 0.7, fill: { color: C.accent }, line: { type: "none" } });
      s.addText(String(i + 1), { x: x + 0.35, y: 2.55, w: 0.7, h: 0.7, fontFace: FONT, fontSize: 20, bold: true, color: C.onInk, align: "center", valign: "middle", margin: 0 });
      s.addText(step.title, { x: x + 0.35, y: 3.45, w: w - 0.7, h: 0.8, fontFace: FONT, fontSize: 18, bold: true, color: C.text, margin: 0, valign: "top" });
      s.addText(step.detail, { x: x + 0.35, y: 4.3, w: w - 0.7, h: 1.4, fontFace: FONT, fontSize: 14, color: C.muted, margin: 0, valign: "top" });
      if (i < steps.length - 1) {
        s.addShape("chevron", { x: x + w + gap / 2 - 0.12, y: 3.85, w: 0.24, h: 0.32, fill: { color: C.line }, line: { type: "none" } });
      }
    });
  }

  // 5 — Architecture: components in flow order + detected stack + language bar
  {
    const s = content(outline.architecture.headline, "Architecture & stack", outline.architecture.notes);
    const parts = outline.architecture.components;
    const gap = 0.5;
    const w = (W - 2 * M - gap * (parts.length - 1)) / parts.length;
    parts.forEach((part, i) => {
      const x = M + i * (w + gap);
      s.addShape("roundRect", { x, y: 2.1, w, h: 1.9, rectRadius: 0.08, fill: { color: i % 2 === 0 ? C.ink : C.inkSoft }, line: { type: "none" } });
      s.addText(part.name, { x: x + 0.2, y: 2.25, w: w - 0.4, h: 0.55, fontFace: FONT, fontSize: 17, bold: true, color: C.onInk, margin: 0, valign: "top" });
      s.addText(part.role, { x: x + 0.2, y: 2.85, w: w - 0.4, h: 1.05, fontFace: FONT, fontSize: 13, color: C.onInkMuted, margin: 0, valign: "top" });
      if (i < parts.length - 1) {
        s.addShape("line", { x: x + w + 0.08, y: 3.05, w: gap - 0.16, h: 0, line: { color: C.accent, width: 2, endArrowType: "triangle" } });
      }
    });
    const chips = facts.stack.length > 0 ? facts.stack : facts.languages.map((l) => l.name);
    s.addText("BUILT WITH", { x: M, y: 4.45, w: 3, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: C.muted, charSpacing: 2, margin: 0 });
    let cx = M;
    for (const chip of chips.slice(0, 9)) {
      const cw = Math.max(0.9, chip.length * 0.11 + 0.45);
      if (cx + cw > W - M) break;
      s.addShape("roundRect", { x: cx, y: 4.85, w: cw, h: 0.42, rectRadius: 0.21, fill: { color: C.accentSoft }, line: { type: "none" } });
      s.addText(chip, { x: cx, y: 4.85, w: cw, h: 0.42, fontFace: FONT, fontSize: 12, bold: true, color: C.text, align: "center", valign: "middle", margin: 0 });
      cx += cw + 0.15;
    }
    languageBar(s, facts, M, 5.75, W - 2 * M);
  }

  // 6 — Features: 2 x 3 grid
  {
    const s = content(outline.features.headline, "Key features", outline.features.notes);
    const items = outline.features.items;
    const cols = items.length <= 4 ? 2 : 3;
    const rows = Math.ceil(items.length / cols);
    const gap = 0.3;
    const w = (W - 2 * M - gap * (cols - 1)) / cols;
    const h = rows === 1 ? 2.6 : (4.6 - gap) / 2;
    items.forEach((item, i) => {
      const x = M + (i % cols) * (w + gap);
      const y = 2.0 + Math.floor(i / cols) * (h + gap);
      card(s, x, y, w, h);
      s.addShape("rect", { x: x + 0.3, y: y + 0.32, w: 0.35, h: 0.06, fill: { color: C.accent }, line: { type: "none" } });
      s.addText(item.title, { x: x + 0.3, y: y + 0.5, w: w - 0.6, h: 0.5, fontFace: FONT, fontSize: 18, bold: true, color: C.text, margin: 0, valign: "top" });
      s.addText(item.detail, { x: x + 0.3, y: y + 1.0, w: w - 0.6, h: h - 1.15, fontFace: FONT, fontSize: 14, color: C.muted, margin: 0, valign: "top" });
    });
  }

  // 7 — Traction: four stat tiles from GitHub + the model's status bullets
  {
    const s = content(outline.traction.headline, "Traction & status", outline.traction.notes);
    const stats: [string, string][] = [
      [compact(facts.stars), "GitHub stars"],
      [compact(facts.forks), "forks"],
      [facts.latestRelease ?? (facts.hasTests ? "tested" : "—"), facts.latestRelease ? "latest release" : "quality"],
      [monthYear(facts.pushedAt), "last update"],
    ];
    const gap = 0.3;
    const w = (W - 2 * M - gap * 3) / 4;
    stats.forEach(([value, label], i) => {
      const x = M + i * (w + gap);
      card(s, x, 2.0, w, 1.7);
      s.addText(value, { x: x + 0.3, y: 2.2, w: w - 0.6, h: 0.85, fontFace: FONT, fontSize: 34, bold: true, color: C.accent, margin: 0, fit: "shrink" });
      s.addText(label, { x: x + 0.3, y: 3.05, w: w - 0.6, h: 0.4, fontFace: FONT, fontSize: 13, color: C.muted, margin: 0 });
    });
    s.addText(
      outline.traction.bullets.map((text) => ({ text, options: { bullet: { code: "25A0" }, paraSpaceAfter: 10 } })),
      { x: M, y: 4.15, w: W - 2 * M, h: 2.5, fontFace: FONT, fontSize: 18, color: C.text, valign: "top", margin: 0 },
    );
  }

  // 8 — Use cases
  {
    const s = content(outline.useCases.headline, "Who it's for", outline.useCases.notes);
    const items = outline.useCases.items;
    const gap = 0.3;
    const w = (W - 2 * M - gap * (items.length - 1)) / items.length;
    items.forEach((item, i) => {
      const x = M + i * (w + gap);
      card(s, x, 2.1, w, 3.0);
      s.addShape("rect", { x, y: 2.1, w, h: 0.12, fill: { color: i % 2 === 0 ? C.accent : C.accent2 }, line: { type: "none" } });
      s.addText(item.audience, { x: x + 0.35, y: 2.55, w: w - 0.7, h: 0.8, fontFace: FONT, fontSize: 20, bold: true, color: C.text, margin: 0, valign: "top" });
      s.addText(item.value, { x: x + 0.35, y: 3.4, w: w - 0.7, h: 1.55, fontFace: FONT, fontSize: 15, color: C.muted, margin: 0, valign: "top" });
    });
  }

  // 9 — Roadmap: timeline
  {
    const s = content(outline.roadmap.headline, "Roadmap", outline.roadmap.notes);
    const items = outline.roadmap.items;
    const y = 3.7;
    s.addShape("line", { x: M, y, w: W - 2 * M, h: 0, line: { color: C.line, width: 3 } });
    const w = (W - 2 * M) / items.length;
    items.forEach((item, i) => {
      const x = M + i * w;
      s.addShape("ellipse", { x: x + 0.05, y: y - 0.2, w: 0.4, h: 0.4, fill: { color: i === 0 ? C.accent : C.card }, line: { color: C.accent, width: 3 } });
      s.addText(item.phase, { x, y: 2.7, w: w - 0.3, h: 0.6, fontFace: FONT, fontSize: 20, bold: true, color: i === 0 ? C.accent : C.text, margin: 0, valign: "bottom" });
      s.addText(item.goal, { x, y: 4.15, w: w - 0.4, h: 2.4, fontFace: FONT, fontSize: 16, color: C.muted, margin: 0, valign: "top" });
    });
  }

  // 10 — The ask
  {
    n += 1;
    const s = pptx.addSlide({ masterName: "DARK" });
    s.addText("THE ASK", { x: M, y: 0.8, w: 6, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.accent, charSpacing: 2, margin: 0 });
    s.addText(outline.ask.headline, { x: M, y: 1.25, w: W - 2 * M, h: 1.5, fontFace: FONT, fontSize: 36, bold: true, color: C.onInk, margin: 0, valign: "top" });
    s.addText(
      outline.ask.bullets.map((text) => ({ text, options: { bullet: { code: "25A0" }, paraSpaceAfter: 14 } })),
      { x: M, y: 3.2, w: 10.5, h: 2.9, fontFace: FONT, fontSize: 22, color: C.onInk, valign: "top", margin: 0 },
    );
    s.addText(facts.homepage || facts.url, { x: M, y: H - 1.0, w: 9, h: 0.35, fontFace: FONT, fontSize: 14, color: C.onInkMuted, margin: 0, hyperlink: { url: facts.homepage || facts.url } });
    if (outline.ask.notes) s.addNotes(outline.ask.notes);
  }

  const data = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return { buffer: data, slideCount: n, title: `${outline.projectName} — pitch deck` };

  function bulletSlide(s: Slide, items: string[], color: string): void {
    const gap = 0.22;
    const h = Math.min(1.05, (4.6 - gap * (items.length - 1)) / items.length);
    items.forEach((text, i) => {
      const y = 2.1 + i * (h + gap);
      card(s, M, y, W - 2 * M, h);
      s.addShape("rect", { x: M, y, w: 0.1, h, fill: { color }, line: { type: "none" } });
      s.addText(text, { x: M + 0.45, y, w: W - 2 * M - 0.8, h, fontFace: FONT, fontSize: 20, color: C.text, valign: "middle", margin: 0 });
    });
  }
}

function card(s: Slide, x: number, y: number, w: number, h: number): void {
  s.addShape("rect", { x, y, w, h, fill: { color: C.card }, line: { color: C.line, width: 1 } });
}

function languageBar(s: Slide, facts: RepoFacts, x: number, y: number, w: number): void {
  const langs = facts.languages.filter((l) => l.share >= 2).slice(0, 5);
  if (langs.length === 0) return;
  const colors = [C.ink, C.accent, C.accent2, "8C90B0", "C9CBDA"];
  const total = langs.reduce((sum, l) => sum + l.share, 0);
  let cx = x;
  langs.forEach((lang, i) => {
    const lw = (lang.share / total) * w;
    s.addShape("rect", { x: cx, y, w: lw, h: 0.18, fill: { color: colors[i]! }, line: { type: "none" } });
    if (lw > 1.2) {
      s.addText(`${lang.name} ${lang.share}%`, { x: cx, y: y + 0.25, w: lw, h: 0.3, fontFace: FONT, fontSize: 11, color: C.muted, margin: 0 });
    }
    cx += lw;
  });
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function monthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
