/**
 * A chart drawn as SVG, saved as a PNG: the SVG is copied with its colours resolved (the charts use
 * CSS variables, which an image cannot see) and the page's own font embedded, drawn twice its size
 * on a white canvas, under the chart's title and, when there are several series, its legend.
 * Browser only. Everything is same-origin (the font files are the site's own), so the CSP holds.
 */

export interface LegendItem {
  label: string;
  color: string;
}

const SCALE = 2;
const PAD = 24;

function resolveVars(value: string, root: CSSStyleDeclaration): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => root.getPropertyValue(name).trim() || "#000");
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** The @font-face rules of the font the chart is set in, with their files inlined. */
async function fontCss(family: string): Promise<string> {
  const first = family.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      if (rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim() !== first) continue;
      let css = rule.cssText;
      for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const data = await toDataUrl(new URL(m[1]!, sheet.href ?? location.href).href);
        if (data) css = css.replace(m[0], `url("${data}")`);
      }
      out.push(css);
    }
  }
  return out.join("\n");
}

export async function svgToPng(svg: SVGSVGElement, { title, legend = [] }: { title: string; legend?: LegendItem[] }): Promise<Blob> {
  const root = getComputedStyle(document.documentElement);
  const family = getComputedStyle(svg).fontFamily;
  const box = svg.viewBox.baseVal;
  const w = box?.width || svg.clientWidth;
  const h = box?.height || svg.clientHeight;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("font-family", family);
  for (const el of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.includes("var(")) el.setAttribute(attr.name, resolveVars(attr.value, root));
    }
  }
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = await fontCss(family);
  clone.insertBefore(style, clone.firstChild);

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("svg image failed"));
      i.src = url;
    });

    const titleH = 36;
    const legendH = legend.length > 1 ? 28 : 0;
    const width = w + PAD * 2;
    const height = h + PAD * 2 + titleH + legendH;
    const canvas = document.createElement("canvas");
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = resolveVars("var(--color-ink)", root);
    ctx.font = `500 18px ${family}`;
    ctx.fillText(title, width - PAD, PAD + titleH / 2 - 4);

    // The legend runs right to left, like the page's.
    let x = width - PAD;
    const ly = PAD + titleH + legendH / 2 - 4;
    ctx.font = `400 13px ${family}`;
    for (const item of legend.length > 1 ? legend : []) {
      ctx.strokeStyle = resolveVars(item.color, root);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x - 18, ly);
      ctx.stroke();
      ctx.fillStyle = resolveVars("var(--color-ink)", root);
      ctx.fillText(item.label, x - 24, ly);
      x -= 24 + ctx.measureText(item.label).width + 20;
    }

    ctx.drawImage(img, PAD, PAD + titleH + legendH, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
