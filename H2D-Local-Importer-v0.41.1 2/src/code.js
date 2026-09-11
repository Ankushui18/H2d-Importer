figma.showUI(__html__, { width: 440, height: 760, themeColors: true });

const BUILD_VERSION = "0.41.4";
function warn(options, code, message) {
  if (!options || !options.warnings) return;
  const key = `${code}:${message}`;
  const existing = options.warningMap.get(key);
  if (existing) { existing.count++; return; }
  const item = { code, message, count: 1 };
  options.warningMap.set(key, item); options.warnings.push(item);
}
async function yieldImport(options, force = false) {
  if (!options) return;
  if (!force && options.stats.nodes % 50 !== 0) return;
  if (options.cancelled) { const error = new Error("Import cancelled"); error.cancelled = true; throw error; }
  await new Promise(resolve => setTimeout(resolve, 0));
  figma.ui.postMessage({ type: "progress", current: options.stats.nodes, total: options.totalNodes || 0, phase: "Rendering" });
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const px = (value, fallback = 0) => { const n = parseFloat(String(value == null ? "" : value)); return Number.isFinite(n) ? n : fallback; };
const rounded = n => Math.round(Number(n || 0) * 10000) / 10000;

function sourceNodeId(node) {
  const explicit = String(node && (node.id || node.uid || node.key || node.path || node.domPath || ""));
  if (explicit) return explicit;
  const attr = node && node.attr || {}, classes = node && node.classList || String(attr.class || "").split(/\s+/).filter(Boolean);
  const seed = [node && (node.tag || node.type || node.kind), attr.id, classes.join("."), rounded(node && node.x), rounded(node && node.y), rounded(node && node.width), rounded(node && node.height), String(node && (node.value || node.text || "")).slice(0, 64)].join("|");
  let hash = 2166136261; for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return `generated:${(hash >>> 0).toString(16)}`;
}

function sourceGeometry(node, parentOrigin) {
  return { x: rounded(px(node && node.x)-px(parentOrigin && parentOrigin.x)), y: rounded(px(node && node.y)-px(parentOrigin && parentOrigin.y)), width: rounded(node && node.width), height: rounded(node && node.height) };
}

function attachSourceMap(figmaNode, source, options, parentOrigin) {
  if (!figmaNode || !options || !options.sourceMap) return;
  try {
    const id = sourceNodeId(source);
    figmaNode.setPluginData("h2d-source-id", id);
    figmaNode.setPluginData("h2d-source-geometry", JSON.stringify(sourceGeometry(source,parentOrigin)));
    figmaNode.setPluginData("h2d-source-tag", String(source && (source.tag || source.type || source.kind || "")));
    if (options.sourceNodeMap) options.sourceNodeMap.set(id, figmaNode);
  } catch (_) {}
}

function recordGeometryAccuracy(figmaNode, source, parentOrigin, options) {
  if (!figmaNode || !source || !options || !options.accuracy) return;
  const expectedX = px(source.x) - px(parentOrigin && parentOrigin.x), expectedY = px(source.y) - px(parentOrigin && parentOrigin.y);
  const positionError = Math.abs(figmaNode.x - expectedX) + Math.abs(figmaNode.y - expectedY);
  const sizeError = Math.abs(figmaNode.width - Math.max(.01, px(source.width, 1))) + Math.abs(figmaNode.height - Math.max(.01, px(source.height, 1)));
  options.accuracy.count++; options.accuracy.positionError += positionError; options.accuracy.sizeError += sizeError;
}
function titleWords(value) { return String(value||"").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[-_.#/]+/g," ").replace(/\s+/g," ").trim().replace(/\b\w/g,letter=>letter.toUpperCase()); }
function semanticIconName(node) {
  const tag=String(node&&(node.tag||node.type||"")).toLowerCase(),attr=node&&node.attr||{},classes=node&&node.classList||String(attr.class||node&&node.className||"").split(/\s+/).filter(Boolean);
  const candidates=[attr["aria-label"],attr.ariaLabel,attr.title,attr.alt,attr.id,node&&node.id,...classes,node&&node.name].filter(Boolean).map(String);
  const iconContext=tag==="svg"||candidates.some(value=>/(^|[-_\s/])icon(?:$|[-_\s/])|(?:^|[-_\s/])(?:flag|close|menu|search|home|user|arrow|chevron)(?:$|[-_\s/])|^fa-|^material-|^mdi-/i.test(value));
  if(!iconContext)return null;
  for(const value of candidates){const label=titleWords(value.replace(/\b(icon|svg|symbol|glyph)\b/ig," "));if(label&& !/^(Default|Frame)$/i.test(label))return `Icon / ${label}`;}
  return "Icon";
}
function semanticLayerName(node) {
  const tag = String(node && (node.tag || node.type || "Frame")).toLowerCase();
  const attr = node && node.attr || {};
  const styles = node && node.styles || {};
  const id = attr.id || node && node.id;
  const rawClasses = (node.classList || String(attr.class || node.className || "").split(/\s+/)).filter(Boolean);
  
  // 1. Data attributes (most specific)
  const dataComponent = attr["data-component"] || attr["data-role"] || attr["data-ui"] || "";
  if (dataComponent) {
    const clean = titleWords(dataComponent.replace(/[-_]+/g, " "));
    return clean;
  }

  // 2. ARIA roles
  const role = attr.role || attr.ariaRole || "";
  if (role) {
    const roleMap = {
      banner: "Header", navigation: "Navigation", main: "Main", complementary: "Aside",
      contentinfo: "Footer", dialog: "Dialog", alert: "Alert", tablist: "Tabs",
      tabpanel: "Tab Panel", menu: "Menu", menubar: "Menu Bar", search: "Search",
      form: "Form", img: "Image", button: "Button", link: "Link", list: "List",
      listitem: "List Item", heading: "Heading", figure: "Figure", status: "Status",
      progressbar: "Progress", article: "Article", section: "Section", navigation: "Navigation"
    };
    if (roleMap[role]) return roleMap[role];
  }

  // 3. ARIA labels / title / alt
  const aria = attr["aria-label"] || attr["ariaLabel"] || attr.title || attr.alt;
  if (aria) return String(aria).trim().slice(0, 60);

  // 4. Icon detection
  const iconName = semanticIconName(node);
  if (iconName) return iconName;

  // 5. Semantic tags
  const semanticTagMap = {
    header: "Header", nav: "Navigation", main: "Main", section: "Section",
    article: "Article", aside: "Aside", footer: "Footer", form: "Form",
    button: "Button", input: "Input", select: "Select", textarea: "Textarea",
    img: "Image", figure: "Figure", label: "Label",
    h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", h5: "Heading", h6: "Heading",
    p: "Text", ul: "List", ol: "List", li: "List Item", a: "Link", svg: "Icon"
  };

  // 6. Filter out utility classes
  const utilityPatterns = [
    /^flex$/, /^grid$/, /^block$/, /^inline-/,
    /^items-/, /^justify-/, /^self-/, /^content-/,
    /^w-/, /^h-/, /^min-/, /^max-/,
    /^p-/, /^m-/, /^px-/, /^py-/, /^pl-/, /^pr-/, /^pt-/, /^pb-/,
    /^text-/, /^font-/, /^leading-/, /^tracking-/,
    /^bg-/, /^border-/, /^rounded-/,
    /^shadow-/, /^opacity-/,
    /^transition-/, /^duration-/, /^ease-/,
    /^cursor-/, /^pointer-events-/,
    /^sm:/, /^md:/, /^lg:/, /^xl:/, /^2xl:/,
    /^hover:/, /^focus:/, /^active:/, /^group-hover:/
  ];
  const isUtility = (cls) => utilityPatterns.some(pattern => pattern.test(cls));
  const meaningfulClasses = rawClasses.filter(cls => !isUtility(cls) && cls.length > 1);

  // 7. Build base name
  let base = semanticTagMap[tag] || "Frame";

  // 8. Append meaningful classes as modifiers
  if (meaningfulClasses.length) {
    const clean = meaningfulClasses
      .map(cls => cls.replace(/[-_]+/g, " ").trim())
      .filter(cls => cls.length > 0)
      .map(cls => cls.replace(/\b\w/g, l => l.toUpperCase()))
      .join(" / ");
    return `${base} / ${clean}`;
  }

  // 9. Append ID if present
  if (id && !String(base).includes(String(id))) {
    const cleanId = String(id).replace(/[-_]+/g, " ").trim().replace(/\b\w/g, l => l.toUpperCase());
    return `${base} / ${cleanId}`;
  }

  // 10. Heuristics for generic divs
  if (tag === "div" || tag === "section") {
    const isFullWidth = Math.abs(px(node.width) - px(node.parent?.width || 0)) < 2;
    const isAtTop = px(node.y) < 20;
    const containsImage = (node.children || []).some(c => c.tag === "img" || c.type === "IMAGE");
    const containsHeading = (node.children || []).some(c => /^h[1-6]$/.test(c.tag));
    if (isFullWidth && isAtTop) return "Hero";
    if (containsImage && containsHeading) return "Card";
    if (isFullWidth) return "Container";
    if (node.children && node.children.length > 3) return "Wrapper";
  }

  return base.replace(/\s+/g, " ").trim().slice(0, 80);
}

function nodeName(node, options) {
  const semantic = semanticLayerName(node);
  if (semantic && semantic !== "Frame") return semantic;
  if (node.name) return node.name;
  if (node.type === "TEXT") return String(node.value || "Text").trim().slice(0, 40) || "Text";
  if (node.type === "SVG") return "SVG";
  const id = node.attr?.id ? `#${node.attr.id}` : "";
  const cls = node.classList?.length ? `.${node.classList.slice(0, 2).join(".")}` : "";
  return `${node.tag || "Frame"}${id}${cls}`;
}

function assetKey(bytes) {
  let hash = 2166136261;
  for (let i=0;i<bytes.length;i++) hash = Math.imul(hash ^ bytes[i], 16777619);
  return (hash >>> 0).toString(16) + ":" + bytes.length;
}
function cssFilterFunctions(value) {
  const text = String(value || ""), out = [];
  let i = 0;
  while (i < text.length) {
    const nameMatch = /[a-z-]+/i.exec(text.slice(i));
    if (!nameMatch || text[i + nameMatch.index] === undefined) break;
    const nameStart = i + nameMatch.index;
    if (text[nameStart + nameMatch[0].length] !== "(") { i = nameStart + nameMatch[0].length; continue; }
    const argStart = nameStart + nameMatch[0].length + 1;
    let depth = 1, j = argStart;
    while (j < text.length && depth > 0) { if (text[j] === "(") depth++; else if (text[j] === ")") depth--; j++; }
    out.push({ name: nameMatch[0].toLowerCase(), raw: text.slice(argStart, j - 1).trim() });
    i = j;
  }
  return out;
}
function cssFilterEffects(value) {
  const text=String(value||"").trim(); if (!text || text === "none") return {effects:[], unsupported:[]};
  const effects=[], unsupported=[];
  for (const { name, raw } of cssFilterFunctions(text)) {
    const n=parseFloat(raw);
    if (name === "blur" && Number.isFinite(n)) effects.push({type:"LAYER_BLUR", radius:Math.max(0,n), visible:true});
    else if (name === "drop-shadow") {
      const parsed = shadowEffects(raw);
      if (parsed.length) effects.push(...parsed.map(effect => ({ ...effect, type: "DROP_SHADOW" })));
      else unsupported.push(name);
    }
    else if (name === "brightness" || name === "contrast" || name === "saturate" || name === "hue-rotate") {
      unsupported.push(name);
    }
    else unsupported.push(name);
  }
  return {effects, unsupported:[...new Set(unsupported)]};
}
const BLEND_MODE_MAP = { normal:"NORMAL", multiply:"MULTIPLY", screen:"SCREEN", overlay:"OVERLAY", darken:"DARKEN", lighten:"LIGHTEN", "color-dodge":"COLOR_DODGE", "color-burn":"COLOR_BURN", "hard-light":"HARD_LIGHT", "soft-light":"SOFT_LIGHT", difference:"DIFFERENCE", exclusion:"EXCLUSION", hue:"HUE", saturation:"SATURATION", color:"COLOR", luminosity:"LUMINOSITY" };
function figmaBlendMode(value) { return BLEND_MODE_MAP[String(value || "normal").trim().toLowerCase()] || null; }


function normalizedPaint(paint) {
  if (!paint) return null;
  const out = { type: paint.type, opacity: rounded(paint.opacity == null ? 1 : paint.opacity) };
  if (paint.color) out.color = { r: rounded(paint.color.r), g: rounded(paint.color.g), b: rounded(paint.color.b) };
  if (paint.gradientStops) out.gradientStops = paint.gradientStops.map(s => ({ position: rounded(s.position), color: { r: rounded(s.color.r), g: rounded(s.color.g), b: rounded(s.color.b), a: rounded(s.color.a) } }));
  if (paint.scaleMode) out.scaleMode = paint.scaleMode;
  return out;
}
const paintsKey = paints => JSON.stringify((paints || []).map(normalizedPaint));
function matchingPaintStyle(styles, paints) { const key = paintsKey(paints); return (styles || []).find(style => paintsKey(style.paints) === key); }

function normalizedEffect(effect) {
  if (!effect) return null;
  return { type: effect.type, radius: rounded(effect.radius), spread: rounded(effect.spread), offset: effect.offset ? { x: rounded(effect.offset.x), y: rounded(effect.offset.y) } : null, color: effect.color ? { r: rounded(effect.color.r), g: rounded(effect.color.g), b: rounded(effect.color.b), a: rounded(effect.color.a) } : null };
}
const effectsKey = effects => JSON.stringify((effects || []).map(normalizedEffect));

function matchingTextStyle(styles, text) {
  if (!text.fontName) return null;
  const normalizeStyle = value => String(value || "Regular").toLowerCase().replace(/[^a-z0-9]/g, "");
  const family = text.fontName.family, styleName = normalizeStyle(text.fontName.style), fontSize = Number(text.fontSize || 0);
  return (styles || []).find(style => style.fontName && style.fontName.family === family && normalizeStyle(style.fontName.style) === styleName && Math.abs(Number(style.fontSize || 0) - fontSize) <= 0.1) || null;
}

function mergedTextRun(node, children) {
  const ordered = children.slice().sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x));
  let value = "", previous = null;
  for (const child of ordered) {
    const part = String(child.value == null ? child.text || child.characters || "" : child.value);
    if (previous && part !== "\n" && !value.endsWith("\n") && Number(child.y) > Number(previous.y) + Math.max(1, Number(previous.height) * .45)) value += "\n";
    value += part; previous = child;
  }
  const styles = node.styles || {}, widths = ordered.filter(child => String(child.value || "") !== "\n").map(child => px(child.width));
  const maxWidth = Math.max(1, ...widths), centered = styles.textAlign === "center", right = styles.textAlign === "right";
  const headingBlock = /^h[1-6]$/i.test(String(node.tag || ""));
  const blockWidth = !centered && !right && headingBlock ? Math.max(maxWidth, px(node.width)) : maxWidth;
  const x = centered ? px(node.x) + (px(node.width) - maxWidth) / 2 : right ? px(node.x) + px(node.width) - maxWidth : px(node.x);
  return { ...ordered[0], value, x, y: Math.min(...ordered.map(child => px(child.y))), width: blockWidth, height: Math.max(...ordered.map(child => px(child.y) + px(child.height))) - Math.min(...ordered.map(child => px(child.y))), exactLineHeight: px(styles.lineHeight) || ordered[0].exactLineHeight, mergedText: true, sourceTag: String(node.tag || "").toLowerCase() };
}

function normalizedChildren(node) {
  const children = node.children || [];
  if (children.length < 2) return children;
  const result = []; let run = [];
  const flush = () => { if (run.length === 1) result.push(run[0]); else if (run.length > 1) result.push(mergedTextRun(node, run)); run = []; };
  for (const child of children) {
    if (String(child.type || "").toUpperCase() === "TEXT") run.push(child);
    else { flush(); result.push(child); }
  }
  flush(); return result;
}

function orderedSourceChildren(node) {
  const children = normalizedChildren(node).map((child, index) => ({ child, index }));
  if (!children.some(item => item.child && item.child.styles && !["", "auto"].includes(String(item.child.styles.zIndex == null ? "auto" : item.child.styles.zIndex).toLowerCase()))) return children.map(item => item.child);
  return children.sort((a, b) => {
    const za = px(a.child && a.child.styles && a.child.styles.zIndex, 0), zb = px(b.child && b.child.styles && b.child.styles.zIndex, 0);
    return za - zb || a.index - b.index;
  }).map(item => item.child);
}

function applyResponsiveConstraints(figmaNode, source, parentSource, options) {
  if (!figmaNode || !source || !parentSource || !options || !options.responsiveConstraints || !("constraints" in figmaNode)) return;
  const s = source.styles || {}, position = String(s.position || "").toLowerCase();
  if (!["absolute", "fixed"].includes(position)) return;
  const left = s.left, right = s.right, top = s.top, bottom = s.bottom;
  let horizontal = "MIN", vertical = "MIN";
  if (left != null && left !== "auto" && right != null && right !== "auto") horizontal = "STRETCH";
  else if (right != null && right !== "auto") horizontal = "MAX";
  else if (String(s.transform || "").includes("translateX(-50%)") || s.marginLeft === "auto" && s.marginRight === "auto") horizontal = "CENTER";
  if (top != null && top !== "auto" && bottom != null && bottom !== "auto") vertical = "STRETCH";
  else if (bottom != null && bottom !== "auto") vertical = "MAX";
  else if (String(s.transform || "").includes("translateY(-50%)")) vertical = "CENTER";
  try { figmaNode.constraints = { horizontal, vertical }; options.stats.constraints = (options.stats.constraints || 0) + 1; } catch (_) {}
}

function cssLength(value) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text || text === "normal" || text === "auto" || text.endsWith("%") || text.endsWith("em") || text.endsWith("rem")) return null;
  const valuePx = parseFloat(text);
  return Number.isFinite(valuePx) ? valuePx : null;
}

function declaredFlowGap(styles, vertical) {
  const direct = cssLength(styles.gap);
  if (direct != null) return direct;
  return cssLength(vertical ? styles.rowGap : styles.columnGap);
}

function declaredMargin(styles, side) {
  const direct = cssLength(styles && styles[`margin${side}`]);
  return direct == null ? 0 : Math.max(0, direct);
}

function semanticSiblingGap(parentStyles, previous, current, vertical, capturedGap) {
  const before = current.styles || {}, after = previous.styles || {};
  let marginGap;
  if (vertical) {
    const previousBottom = declaredMargin(after, "Bottom"), currentTop = declaredMargin(before, "Top");
    marginGap = parentStyles.display === "block" ? Math.max(previousBottom, currentTop) : previousBottom + currentTop;
  } else {
    marginGap = declaredMargin(after, "Right") + declaredMargin(before, "Left");
  }
  return marginGap > .25 && Math.abs(marginGap - capturedGap) <= .75 ? { value: capturedGap, kind: "Margin" } : { value: capturedGap, kind: "Gap" };
}

function autoLayoutSpec(node) {
  const s = node.styles || {}, children = normalizedChildren(node).filter(child => String(child.styles && child.styles.position || "").toLowerCase() !== "absolute");
  // Allow 'block' as well as flex/grid, but still skip single-child identical wrappers
  if (!["flex", "block", "grid"].includes(s.display) || children.length < 1 || children.length > 20) return null;
  if (children.some(c => !Number.isFinite(Number(c.x)) || !Number.isFinite(Number(c.y)) || !Number.isFinite(Number(c.width)) || !Number.isFinite(Number(c.height)))) return null;
  // For block with single child that has identical bounds, skip
  if (s.display === "block" && children.length === 1) {
    const child = children[0], fixed = value => !["", "auto", "fit-content", "max-content", "min-content"].includes(String(value == null ? "" : value).trim().toLowerCase());
    const sameBounds = Math.abs(px(child.x) - px(node.x)) <= .25 && Math.abs(px(child.y) - px(node.y)) <= .25 && Math.abs(px(child.width) - px(node.width)) <= .25 && Math.abs(px(child.height) - px(node.height)) <= .25;
    if (fixed(s.width) && fixed(s.height) && sameBounds) return null;
  }
  // For flex/grid, we already have display check.
  const vertical = s.display !== "flex" || s.flexDirection === "column", start = vertical ? "y" : "x", size = vertical ? "height" : "width";
  const ordered = children.slice().sort((a, b) => Number(a[start]) - Number(b[start]));
  const gaps = [];
  for (let i = 1; i < ordered.length; i++) { const gap = Number(ordered[i][start]) - (Number(ordered[i - 1][start]) + Number(ordered[i - 1][size])); if (gap < -0.5) return null; gaps.push(gap); }
  const cssGap = declaredFlowGap(s, vertical);
  const gapRange = gaps.length > 1 ? Math.max(...gaps) - Math.min(...gaps) : 0;
  const cssGapMatches = cssGap != null && gaps.every(gap => Math.abs(gap - cssGap) <= .5);
  const variableGaps = gaps.length > 1 && !cssGapMatches && gapRange > .25;
  const gapBefore = new Map();
  if (variableGaps) for (let i = 1; i < ordered.length; i++) gapBefore.set(ordered[i], semanticSiblingGap(s, ordered[i - 1], ordered[i], vertical, Math.max(0, gaps[i - 1])));
  const parentStart = Number(node[start]), parentSize = Number(node[size]);
  const leading = Math.max(0, Number(ordered[0][start]) - parentStart), trailing = Math.max(0, parentStart + parentSize - (Number(ordered[ordered.length - 1][start]) + Number(ordered[ordered.length - 1][size])));
  const crossStart = vertical ? Math.min(...children.map(c => Number(c.x))) - Number(node.x) : Math.min(...children.map(c => Number(c.y))) - Number(node.y);
  const crossEnd = vertical ? Math.max(...children.map(c => Number(c.x) + Number(c.width))) - Number(node.x) : Math.max(...children.map(c => Number(c.y) + Number(c.height))) - Number(node.y);
  const crossSize = vertical ? Number(node.width) : Number(node.height);
  const commonGap = cssGapMatches ? cssGap : gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  return { mode: vertical ? "VERTICAL" : "HORIZONTAL", gap: variableGaps ? 0 : commonGap, variableGaps, gapBefore, leading, trailing, crossStart: Math.max(0, crossStart), crossTrailing: Math.max(0, crossSize - crossEnd) };
}

function clusterStarts(values, tolerance) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && value - last.start <= tolerance) last.members.push(value);
    else clusters.push({ start: value, members: [value] });
  }
  return clusters.map(c => c.members.reduce((a, b) => a + b, 0) / c.members.length);
}

function gridLayoutSpec(node) {
  const s = node.styles || {};
  if (String(s.display || "").toLowerCase() !== "grid") return null;
  const children = normalizedChildren(node).filter(child => String(child.styles && child.styles.position || "").toLowerCase() !== "absolute");
  if (children.length < 2 || children.length > 60) return null;
  if (children.some(c => !Number.isFinite(Number(c.x)) || !Number.isFinite(Number(c.y)) || !Number.isFinite(Number(c.width)) || !Number.isFinite(Number(c.height)))) return null;
  
  let areas = null;
  if (s.gridTemplateAreas) {
    const areaString = String(s.gridTemplateAreas).replace(/["']/g, "").trim();
    areas = areaString.split(/\s+/).filter(Boolean).map(row => row.split(/\s+/).filter(Boolean));
  }
  
  const rowStarts = clusterStarts(children.map(c => Number(c.y)), 2);
  const colStarts = clusterStarts(children.map(c => Number(c.x)), 2);
  if (rowStarts.length > 24 || colStarts.length > 24) return null;
  const rowOf = y => { let best = 0, bestDelta = Infinity; rowStarts.forEach((r, i) => { const d = Math.abs(y - r); if (d < bestDelta) { bestDelta = d; best = i; } }); return bestDelta <= 2 ? best : -1; };
  const colOf = x => { let best = 0, bestDelta = Infinity; colStarts.forEach((c, i) => { const d = Math.abs(x - c); if (d < bestDelta) { bestDelta = d; best = i; } }); return bestDelta <= 2 ? best : -1; };
  const cellFor = new Map(); const occupied = new Set();
  for (const child of children) {
    const row = rowOf(Number(child.y)), col = colOf(Number(child.x));
    if (row < 0 || col < 0) return null;
    const cx0 = Number(child.x), cx1 = cx0 + Number(child.width), cy0 = Number(child.y), cy1 = cy0 + Number(child.height);
    const spansColumn = colStarts.some((start, i) => i !== col && start > cx0 + 2 && start < cx1 - 2);
    const spansRow = rowStarts.some((start, i) => i !== row && start > cy0 + 2 && start < cy1 - 2);
    if (spansColumn || spansRow) return null;
    const key = `${row}:${col}`;
    if (occupied.has(key)) return null;
    occupied.add(key); cellFor.set(child, { row, col });
  }
  const rowSizes = rowStarts.map((start, i) => {
    const members = children.filter(c => cellFor.get(c).row === i);
    return Math.max(1, Math.max(...members.map(c => Number(c.height))));
  });
  const colSizes = colStarts.map((start, i) => {
    const members = children.filter(c => cellFor.get(c).col === i);
    return Math.max(1, Math.max(...members.map(c => Number(c.width))));
  });
  const rowGapValues = []; for (let i = 1; i < rowStarts.length; i++) rowGapValues.push(Math.max(0, rowStarts[i] - (rowStarts[i - 1] + rowSizes[i - 1])));
  const colGapValues = []; for (let i = 1; i < colStarts.length; i++) colGapValues.push(Math.max(0, colStarts[i] - (colStarts[i - 1] + colSizes[i - 1])));
  const declaredRowGap = declaredFlowGap(s, true), declaredColGap = declaredFlowGap(s, false);
  const rowGap = declaredRowGap != null ? declaredRowGap : rowGapValues.length ? rowGapValues.reduce((a, b) => a + b, 0) / rowGapValues.length : 0;
  const colGap = declaredColGap != null ? declaredColGap : colGapValues.length ? colGapValues.reduce((a, b) => a + b, 0) / colGapValues.length : 0;
  const paddingTop = Math.max(0, rowStarts[0] - Number(node.y)), paddingLeft = Math.max(0, colStarts[0] - Number(node.x));
  const paddingBottom = Math.max(0, (Number(node.y) + Number(node.height)) - (rowStarts[rowStarts.length - 1] + rowSizes[rowSizes.length - 1]));
  const paddingRight = Math.max(0, (Number(node.x) + Number(node.width)) - (colStarts[colStarts.length - 1] + colSizes[colSizes.length - 1]));
  const areaMap = areas ? {} : null;
  if (areas) {
    if (areas.length !== rowStarts.length || areas[0].length !== colStarts.length) {
      return null;
    }
    for (let r = 0; r < Math.min(areas.length, rowStarts.length); r++) {
      const row = areas[r];
      for (let c = 0; c < Math.min(row.length, colStarts.length); c++) {
        const name = row[c];
        if (name && name !== ".") {
          areaMap[name] = { row: r, col: c };
        }
      }
    }
  }
  return { rowCount: rowStarts.length, colCount: colStarts.length, rowSizes, colSizes, rowGap, colGap, paddingTop, paddingRight, paddingBottom, paddingLeft, cellFor, areaMap };
}

function colorToPaint(value, keepTransparent = false) {
  if (!value || value === "transparent") return null;
  const text = String(value).trim();
  let m = text.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) { const n = parseInt(m[1], 16); return { type: "SOLID", color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }, opacity: m[2] ? parseInt(m[2], 16) / 255 : 1 }; }
  m = text.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (!m) return null;
  const opacity = m[4] == null ? 1 : clamp(Number(m[4]), 0, 1);
  if (opacity === 0 && !keepTransparent) return null;
  return { type: "SOLID", color: { r: clamp(Number(m[1]) / 255, 0, 1), g: clamp(Number(m[2]) / 255, 0, 1), b: clamp(Number(m[3]) / 255, 0, 1) }, opacity };
}

function splitCssList(value) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) { const c = value[i]; if (c === "(") depth++; else if (c === ")") depth--; else if (c === "," && depth === 0) { out.push(value.slice(start, i).trim()); start = i + 1; } }
  out.push(value.slice(start).trim()); return out.filter(Boolean);
}

function transformFromGradientHandles(start, end) {
  const dx = end.x - start.x, dy = end.y - start.y, det = dx * dx + dy * dy || 1;
  const e = start.x + dy * .5, f = start.y - dx * .5;
  return [[dx / det, dy / det, (-dy * f - dx * e) / det], [-dy / det, dx / det, (dy * e - dx * f) / det]];
}

function normalizeTransparentGradientStops(stops) {
  const visible = stops.filter(stop => Number(stop.color && stop.color.a) > 0);
  if (!visible.length) return stops;
  return stops.map(stop => {
    if (Number(stop.color && stop.color.a) !== 0) return stop;
    let nearest = visible[0], distance = Math.abs(Number(stop.position) - Number(nearest.position));
    for (let i = 1; i < visible.length; i++) {
      const nextDistance = Math.abs(Number(stop.position) - Number(visible[i].position));
      if (nextDistance < distance) { nearest = visible[i]; distance = nextDistance; }
    }
    return { ...stop, color: { r: nearest.color.r, g: nearest.color.g, b: nearest.color.b, a: 0 } };
  });
}

function gradientPaint(value, width = 1, height = 1) {
  const conicMatch = String(value || "").match(/conic-gradient\((.*)\)/i);
  if (conicMatch) {
    const parts = splitCssList(conicMatch[1]);
    const stops = normalizeTransparentGradientStops(parts.map((part, index) => {
      const match = part.match(/(rgba?\([^)]*\)|#[0-9a-f]{6,8})(?:\s+([\d.]+)(deg|grad|rad|turn)?)?/i);
      if (!match) return null;
      const paint = colorToPaint(match[1], true);
      if (!paint) return null;
      let position = index / Math.max(1, parts.length - 1);
      if (match[2]) {
        const angle = parseFloat(match[2]);
        if (match[3] === "deg") position = angle / 360;
        else if (match[3] === "grad") position = angle / 400;
        else if (match[3] === "rad") position = angle / (2 * Math.PI);
        else if (match[3] === "turn") position = angle;
        position = clamp(position, 0, 1);
      }
      return { position, color: { ...paint.color, a: paint.opacity == null ? 1 : paint.opacity } };
    }).filter(Boolean));
    if (stops.length < 2) return null;
    return { type: "GRADIENT_ANGULAR", gradientStops: stops, gradientTransform: [[1,0,0],[0,1,0]] };
  }

  const m = String(value || "").match(/linear-gradient\((.*)\)/i); if (!m) return null;
  const parts = splitCssList(m[1]); let angle = 180;
  if (/deg$/i.test(parts[0])) angle = px(parts.shift(), 180);
  else if (/^to\s+/i.test(parts[0])) { const d = parts.shift().toLowerCase(); angle = d.includes("right") ? 90 : d.includes("left") ? 270 : d.includes("top") ? 0 : 180; }
  const stops = normalizeTransparentGradientStops(parts.map((part, index) => { const match = part.match(/(rgba?\([^)]*\)|#[0-9a-f]{6,8})(?:\s+([\d.]+)%?)?/i); if (!match) return null; const paint = colorToPaint(match[1], true); if (!paint) return null; return { position: match[2] == null ? index / Math.max(1, parts.length - 1) : clamp(Number(match[2]) / 100, 0, 1), color: { ...paint.color, a: paint.opacity == null ? 1 : paint.opacity } }; }).filter(Boolean));
  if (stops.length < 2) return null;
  const rad = angle * Math.PI / 180, vx = Math.sin(rad), vy = -Math.cos(rad);
  const w = Math.max(.01, Number(width) || 1), h = Math.max(.01, Number(height) || 1);
  const lineLength = Math.abs(w * vx) + Math.abs(h * vy);
  const start = { x: .5 - vx * lineLength / (2 * w), y: .5 - vy * lineLength / (2 * h) };
  const end = { x: .5 + vx * lineLength / (2 * w), y: .5 + vy * lineLength / (2 * h) };
  return { type: "GRADIENT_LINEAR", gradientStops: stops, gradientTransform: transformFromGradientHandles(start, end) };
}

function radialGradientPaint(value) {
  const m = String(value || "").match(/radial-gradient\((.*)\)/i); if (!m) return null;
  const parts = splitCssList(m[1]);
  while (parts.length && !/(rgba?\(|#[0-9a-f]{6,8})/i.test(parts[0])) parts.shift();
  const stops = normalizeTransparentGradientStops(parts.map((part, index) => { const match = part.match(/(rgba?\([^)]*\)|#[0-9a-f]{6,8})(?:\s+([\d.]+)(%|px)?)?/i); if (!match) return null; const paint = colorToPaint(match[1], true); if (!paint) return null; let position = index / Math.max(1, parts.length - 1); if (match[2] && match[3] === "%") position = clamp(Number(match[2]) / 100, 0, 1); return { position, color: { ...paint.color, a: paint.opacity == null ? 1 : paint.opacity } }; }).filter(Boolean));
  if (stops.length < 2) return null;
  return { type: "GRADIENT_RADIAL", gradientStops: stops, gradientTransform: [[1, 0, 0], [0, 1, 0]] };
}

function backgroundGradientPaints(value, width, height) {
  return splitCssList(String(value || "")).map(layer => gradientPaint(layer, width, height) || radialGradientPaint(layer)).filter(Boolean).reverse();
}

function backdropBlurEffect(styles) {
  const value = styles.backdropFilter || styles.webkitBackdropFilter || "";
  const match = String(value).match(/blur\(\s*([\d.]+)px\s*\)/i);
  return match && Number(match[1]) > 0 ? { type: "BACKGROUND_BLUR", radius: Number(match[1]), visible: true } : null;
}

function shouldClipNode(node, styles) {
  const values = [styles.overflow, styles.overflowX, styles.overflowY].map(value => String(value || "").toLowerCase());
  if (values.some(value => value === "hidden" || value === "clip")) return true;
  if (!values.some(value => value === "auto" || value === "scroll")) return false;
  if (node.isScrollingElt) return true;
  const left = px(node.x), top = px(node.y), right = left + px(node.width), bottom = top + px(node.height);
  return (node.children || []).some(child => px(child.x) < left - .5 || px(child.y) < top - .5 || px(child.x) + px(child.width) > right + .5 || px(child.y) + px(child.height) > bottom + .5);
}

function borderWidths(value) {
  const values = String(value || "0").match(/-?[\d.]+/g)?.map(Number) || [0];
  if (values.length === 1) return [values[0], values[0], values[0], values[0]];
  if (values.length === 2) return [values[0], values[1], values[0], values[1]];
  if (values.length === 3) return [values[0], values[1], values[2], values[1]];
  return values.slice(0, 4);
}

function borderColors(value) {
  const values = String(value || "").match(/rgba?\([^)]*\)|#[0-9a-f]{6,8}/ig) || [];
  if (!values.length) return [];
  if (values.length === 1) return [values[0], values[0], values[0], values[0]];
  if (values.length === 2) return [values[0], values[1], values[0], values[1]];
  if (values.length === 3) return [values[0], values[1], values[2], values[1]];
  return values.slice(0, 4);
}

function radiusValue(value, width, height) {
  const token = String(value == null ? "" : value).trim().split(/[\s/]+/)[0];
  if (!token) return 0;
  const maximum = Math.max(0, Math.min(Number(width) || 0, Number(height) || 0) / 2);
  const result = token.endsWith("%") ? Math.min(Number(width) || 0, Number(height) || 0) * px(token) / 100 : px(token);
  return clamp(Math.max(0, result), 0, maximum);
}

function frameRadii(styles, width, height) {
  const shorthand = String(styles.borderRadius || "").split("/")[0].trim().split(/\s+/).filter(Boolean);
  let expanded = shorthand.length === 1 ? [shorthand[0], shorthand[0], shorthand[0], shorthand[0]] :
    shorthand.length === 2 ? [shorthand[0], shorthand[1], shorthand[0], shorthand[1]] :
    shorthand.length === 3 ? [shorthand[0], shorthand[1], shorthand[2], shorthand[1]] : shorthand.slice(0, 4);
  if (!expanded.length) expanded = [0, 0, 0, 0];
  const direct = [styles.borderTopLeftRadius, styles.borderTopRightRadius, styles.borderBottomRightRadius, styles.borderBottomLeftRadius];
  return direct.map((value, index) => radiusValue(value == null || value === "" ? expanded[index] : value, width, height));
}

function shadowEffects(value) {
  if (!value || value === "none") return [];
  return splitCssList(String(value)).map(part => { const colorMatch = part.match(/rgba?\([^)]*\)|#[0-9a-f]{6,8}/i), paint = colorToPaint(colorMatch && colorMatch[0]); if (!paint) return null; const inset = /\binset\b/i.test(part); const nums = part.replace(colorMatch[0], "").replace(/inset/ig, "").match(/-?[\d.]+/g) || []; return { type: inset ? "INNER_SHADOW" : "DROP_SHADOW", color: { ...paint.color, a: paint.opacity == null ? 1 : paint.opacity }, offset: { x: Number(nums[0] || 0), y: Number(nums[1] || 0) }, radius: Math.max(0, Number(nums[2] || 0)), spread: Number(nums[3] || 0), visible: true, blendMode: "NORMAL" }; }).filter(Boolean).reverse();
}

function applyTransform(node, value, options, label) {
  if (!value || value === "none") return;
  const text=String(value); let handled=false;
  if ("rotation" in node) { const rotate=text.match(/rotate\((-?[\d.]+)deg\)/i); if(rotate){node.rotation=-Number(rotate[1]);handled=true} }
  const translate=text.match(/translate\(\s*(-?[\d.]+)px(?:\s*,\s*|\s+)(-?[\d.]+)px\s*\)/i),tx=text.match(/translateX\(\s*(-?[\d.]+)px\s*\)/i),ty=text.match(/translateY\(\s*(-?[\d.]+)px\s*\)/i);
  if(translate){node.x+=Number(translate[1]);node.y+=Number(translate[2]);handled=true}else{if(tx){node.x+=Number(tx[1]);handled=true}if(ty){node.y+=Number(ty[1]);handled=true}}
  const scale=text.match(/scale\(\s*(-?[\d.]+)(?:\s*,\s*|\s+)?(-?[\d.]+)?\s*\)/i);
  if(scale&&"resize" in node){const sx=Math.abs(Number(scale[1])),sy=Math.abs(Number(scale[2]||scale[1]));if(sx>0&&sy>0){const oldW=node.width,oldH=node.height,newW=Math.max(.01,oldW*sx),newH=Math.max(.01,oldH*sy);node.resize(newW,newH);node.x+=(oldW-newW)/2;node.y+=(oldH-newH)/2;handled=true}}
  const matrix=text.match(/matrix\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/i);
  if(matrix){node.x+=Number(matrix[5]);node.y+=Number(matrix[6]);if("rotation" in node)node.rotation=-Math.atan2(Number(matrix[2]),Number(matrix[1]))*180/Math.PI;handled=true}
  if(!handled||/(skew|perspective|matrix3d)/i.test(text))warn(options,"CSS_TRANSFORM",`Transform retained as captured geometry on ${label||node.name}: ${text.slice(0,100)}`);
}

function decodeBase64(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(value || "").replace(/[^A-Za-z0-9+/=]/g, ""), out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = alphabet.indexOf(clean[i]), b = alphabet.indexOf(clean[i + 1]);
    const c = clean[i + 2] === "=" ? -1 : alphabet.indexOf(clean[i + 2]), d = clean[i + 3] === "=" ? -1 : alphabet.indexOf(clean[i + 3]);
    out.push((a << 2) | (b >> 4)); if (c >= 0) out.push(((b & 15) << 4) | (c >> 2)); if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

function createCachedImage(bytes, options) {
  if (!bytes || !options) return null;
  const key=assetKey(bytes);
  if (options.imageCache.has(key)) { options.stats.imagesReused = (options.stats.imagesReused || 0) + 1; return options.imageCache.get(key); }
  const image=figma.createImage(bytes);
  options.imageCache.set(key,image);
  options.stats.imagesReused = options.stats.imagesReused || 0;
  return image;
}

function imageBytesFromNode(node, payload) {
  const attr = node.attr || {}, source = node.$url || attr.src || attr["data-src"] || node.src || node.poster || attr.poster;
  if (!source) return null;
  const asset = payload.assets && payload.assets[source];
  if (asset && asset.content) return decodeBase64(asset.content);
  const data = String(source).match(/^data:[^;,]+;base64,(.*)$/i); return data ? decodeBase64(data[1]) : null;
}

function imageBytesFromSource(source, payload) {
  const asset = payload.assets && payload.assets[source];
  if (asset && asset.content) return decodeBase64(asset.content);
  const data = String(source || "").match(/^data:[^;,]+;base64,(.*)$/i);
  return data ? decodeBase64(data[1]) : null;
}

function resolvedBackgroundPaints(styles, node, payload, options) {
  const base = colorToPaint(styles.backgroundColor || node.backgroundColor), paints = base ? [base] : [];
  for (const layer of splitCssList(String(styles.backgroundImage || "")).reverse()) {
    const gradient = gradientPaint(layer, node.width, node.height) || radialGradientPaint(layer);
    if (gradient) { paints.push(gradient); options.stats.gradients++; continue; }
    const match = layer.match(/url\(["']?([^"')]+)["']?\)/i); if (!match) continue;
    const bytes = imageBytesFromSource(match[1], payload); if (!bytes) { warn(options, "IMAGE_BACKGROUND", `Missing background asset on ${nodeName(node, options)}: ${match[1].slice(0, 80)}`); continue; }
    try { const image = createCachedImage(bytes, options); paints.push({ type: "IMAGE", imageHash: image.hash, scaleMode: String(styles.backgroundSize).includes("contain") ? "FIT" : "FILL" }); }
    catch (error) { warn(options, "IMAGE_BACKGROUND", `Background image failed on ${nodeName(node, options)}: ${error && error.message || error}`); }
  }
  return paints;
}

function positionAndSize(figmaNode, node, parentOrigin) {
  figmaNode.x = px(node.x) - parentOrigin.x; figmaNode.y = px(node.y) - parentOrigin.y;
  if ("resize" in figmaNode) figmaNode.resize(Math.max(0.01, px(node.width, 1)), Math.max(0.01, px(node.height, 1)));
}

async function applyFrameStyle(frame, node, payload, options) {
  const s = node.styles || {};
  frame.fills = resolvedBackgroundPaints(s, node, payload, options); frame.opacity = clamp(Number(s.opacity == null ? 1 : s.opacity), 0, 1);
  frame.clipsContent = shouldClipNode(node, s);
  const radii = frameRadii(s, node.width, node.height);
  if (radii.some(Boolean)) { frame.topLeftRadius = radii[0]; frame.topRightRadius = radii[1]; frame.bottomRightRadius = radii[2]; frame.bottomLeftRadius = radii[3]; }
  const widths = borderWidths(s.borderWidth), colors = borderColors(s.borderColor), firstVisibleSide = widths.findIndex(v => v > 0), stroke = firstVisibleSide >= 0 ? colorToPaint(colors[firstVisibleSide] || colors[0]) : null;
  if (s.borderWidth && stroke && widths.some(v => v > 0)) {
    frame.strokes = [stroke]; frame.strokeTopWeight = Math.max(0, widths[0]); frame.strokeRightWeight = Math.max(0, widths[1]); frame.strokeBottomWeight = Math.max(0, widths[2]); frame.strokeLeftWeight = Math.max(0, widths[3]);
    const borderStyle = String(s.borderStyle || "").toLowerCase().split(/\s+/)[0];
    if ("dashPattern" in frame) {
      if (borderStyle === "dashed") frame.dashPattern = [Math.max(1, widths[0] || widths[1] || widths[2] || widths[3] || 1) * 2.5, Math.max(1, widths[0] || widths[1] || widths[2] || widths[3] || 1) * 1.5];
      else if (borderStyle === "dotted") frame.dashPattern = [1, Math.max(1, (widths[0] || widths[1] || 1) * 1.5)];
    }
  }
  const blend = figmaBlendMode(s.mixBlendMode);
  if (blend && "blendMode" in frame) frame.blendMode = blend;
  const effects = shadowEffects(s.boxShadow), backgroundBlur = backdropBlurEffect(s), filterInfo = cssFilterEffects(s.filter);
  if (effects.length || backgroundBlur || filterInfo.effects.length) frame.effects = [...effects, ...(backgroundBlur ? [backgroundBlur] : []), ...filterInfo.effects];
  if (filterInfo.unsupported.length) warn(options, "CSS_FILTER", `Unsupported CSS filter on ${nodeName(node, options)}: ${filterInfo.unsupported.join(", ")}`);
  applyTransform(frame, s.transform, options, nodeName(node, options));
  const mediaBytes = imageBytesFromNode(node, payload);
  if (mediaBytes) { try { const image = createCachedImage(mediaBytes, options); frame.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: String(s.objectFit || attrObjectFit(node)).includes("contain") ? "FIT" : "FILL" }]; } catch (error) { warn(options, "IMAGE_MEDIA", `Image failed on ${nodeName(node)}: ${error && error.message || error}`); } }
  // Store flow/grid specs
  const flow = options.autoLayout ? autoLayoutSpec(node) : null;
  if (flow) {
    options.flowFrames.add(frame);
    options.flowSpecs.set(frame, flow);
  } else if (options.autoLayout && String(s.display || "").toLowerCase() === "grid" && String(node.tag || "").toLowerCase() !== "html" && "layoutMode" in frame) {
    try {
      const grid = gridLayoutSpec(node);
      if (grid) {
        try {
          options.gridFrames.add(frame);
          options.gridSpecs.set(frame, grid);
          options.stats.grids = (options.stats.grids || 0) + 1;
        } catch (error) {
          options.gridFrames.delete(frame); options.gridSpecs.delete(frame);
          warn(options, "CSS_GRID", `Grid layout failed on ${nodeName(node, options)}, kept pixel-positioned: ${error && error.message || error}`);
        }
      } else {
        warn(options, "CSS_GRID", `Complex/irregular grid kept pixel-positioned: ${nodeName(node, options)}`);
      }
    } catch (error) {
      options.gridFrames.delete(frame); options.gridSpecs.delete(frame);
      warn(options, "CSS_GRID", `Grid detection failed on ${nodeName(node, options)}, kept pixel-positioned: ${error && error.message || error}`);
    }
  }
  if (options.useExistingStyles && options.localStyles) {
    const fillStyle = matchingPaintStyle(options.localStyles.paints, frame.fills);
    if (fillStyle) try { await frame.setFillStyleIdAsync(fillStyle.id); } catch (_) {}
    const strokeStyle = matchingPaintStyle(options.localStyles.paints, frame.strokes);
    if (strokeStyle) try { await frame.setStrokeStyleIdAsync(strokeStyle.id); } catch (_) {}
    const effectStyle = (options.localStyles.effects || []).find(style => effectsKey(style.effects) === effectsKey(frame.effects));
    if (effectStyle && frame.effects && frame.effects.length) try { await frame.setEffectStyleIdAsync(effectStyle.id); } catch (_) {}
  }
}

function attrObjectFit(node) { return node.styles && node.styles.objectFit || "cover"; }

function fontStyleFrom(styles) {
  const weight = Number(styles.fontWeight || 400), italic = String(styles.fontStyle || "").toLowerCase() === "italic";
  if (weight >= 700) return italic ? "Bold Italic" : "Bold"; if (weight >= 600) return italic ? "Semi Bold Italic" : "Semi Bold"; if (weight >= 500) return italic ? "Medium Italic" : "Medium"; return italic ? "Italic" : "Regular";
}

function capturedTextSignature(styles, node) {
  const family = String(node.font || styles.fontFamily || "Inter").split(",")[0].replace(/["']/g, "").trim();
  return `${family}|${fontStyleFrom(styles)}|${Math.max(1, Math.round(px(styles.fontSize, 16)))}`;
}

function variableField(variable) {
  const scopes = variable.scopes || [];
  const pairs = [["FONT_FAMILY", "fontFamily"], ["FONT_STYLE", "fontStyle"], ["FONT_WEIGHT", "fontWeight"], ["FONT_SIZE", "fontSize"], ["LINE_HEIGHT", "lineHeight"], ["LETTER_SPACING", "letterSpacing"], ["PARAGRAPH_SPACING", "paragraphSpacing"], ["PARAGRAPH_INDENT", "paragraphIndent"]];
  for (const pair of pairs) if (scopes.includes(pair[0])) return pair[1];
  return null;
}

function applyTypographyVariables(text, variables) {
  const byField = {};
  for (const variable of variables || []) { const field = variableField(variable); if (field) (byField[field] ||= []).push(variable); }
  const current = { fontFamily: text.fontName && text.fontName.family, fontStyle: text.fontName && text.fontName.style, fontWeight: Number(text.fontWeight), fontSize: Number(text.fontSize), lineHeight: text.lineHeight && text.lineHeight.unit === "PIXELS" ? Number(text.lineHeight.value) : null, letterSpacing: text.letterSpacing && text.letterSpacing.unit === "PIXELS" ? Number(text.letterSpacing.value) : null, paragraphSpacing: Number(text.paragraphSpacing), paragraphIndent: Number(text.paragraphIndent) };
  for (const field of Object.keys(byField)) {
    const candidates = byField[field].map(variable => { try { return { variable, value: variable.resolveForConsumer(text).value }; } catch (_) { return null; } }).filter(Boolean);
    let chosen = candidates.length === 1 ? candidates[0] : null;
    if (!chosen) {
      const target = current[field];
      chosen = candidates.find(item => typeof target === "string" ? String(item.value).toLowerCase() === target.toLowerCase() : Number.isFinite(target) && Math.abs(Number(item.value) - target) <= (field === "fontSize" || field === "lineHeight" ? 1.01 : field === "fontWeight" ? 1 : .25));
    }
    if (chosen) try { text.setBoundVariable(field, chosen.variable); } catch (_) {}
  }
}

async function applyResolvedTextStyle(text, style) {
  await figma.loadFontAsync(style.fontName);
  text.fontName = style.fontName;
  text.fontSize = style.fontSize;
  if (style.lineHeight) text.lineHeight = style.lineHeight;
  if (style.letterSpacing) text.letterSpacing = style.letterSpacing;
  if (Number.isFinite(Number(style.paragraphSpacing))) text.paragraphSpacing = Number(style.paragraphSpacing);
  if (Number.isFinite(Number(style.paragraphIndent))) text.paragraphIndent = Number(style.paragraphIndent);
  if (style.textCase) text.textCase = style.textCase;
  if (style.textDecoration) text.textDecoration = style.textDecoration;
  await text.setTextStyleIdAsync(style.id);
}

async function loadBestFont(styles, node, options) {
  const requested = String(node.font || styles.fontFamily || "Inter").split(",")[0].replace(/["']/g, "").trim(), mapped = options.fontMap[requested] || requested, style = fontStyleFrom(styles);
  const aliases = { "Semi Bold": ["Semi Bold", "SemiBold", "Demi Bold", "DemiBold"], "Medium": ["Medium"], "Bold": ["Bold"], "Regular": ["Regular", "Roman", "Book"], "Italic": ["Italic"], "Medium Italic": ["Medium Italic", "MediumItalic"], "Semi Bold Italic": ["Semi Bold Italic", "SemiBold Italic", "SemiBoldItalic"], "Bold Italic": ["Bold Italic", "BoldItalic"] };
  let familyStyles = options.availableFontMap && options.availableFontMap[mapped] || [];
  if (options.customFonts && options.customFonts[mapped]) {
    const customStyles = options.customFonts[mapped];
    familyStyles = familyStyles.concat(customStyles);
  }
  const preferred = (aliases[style] || [style]).filter(name => familyStyles.includes(name));
  const regular = (aliases.Regular || []).filter(name => familyStyles.includes(name));
  const familyFallback = familyStyles.length ? [familyStyles[0]] : [];
  const candidates = [...preferred, ...regular, ...familyFallback, style, "Regular"].map(name => ({ family: mapped || "Inter", style: name })).concat([{ family: "Inter", style }, { family: "Inter", style: "Regular" }]);
  for (const font of candidates) { try { await figma.loadFontAsync(font); return font; } catch (_) {} }
  throw new Error(`No usable font found for ${requested}`);
}

async function makeText(node, parent, parentOrigin, inheritedStyles, options) {
  const t = figma.createText(), styles = inheritedStyles || {}, requestedFamily = String(node.font || styles.fontFamily || "Inter").split(",")[0].replace(/["']/g, "").trim(), font = await loadBestFont(styles, node, options);
  if (font.family !== requestedFamily) warn(options, "FONT_FALLBACK", `Font ${requestedFamily} was mapped/fallback to ${font.family}`);
  t.fontName = font; let characters = String(node.value == null ? node.text || node.characters || "" : node.value); if (styles.textTransform === "uppercase") characters = characters.toUpperCase(); else if (styles.textTransform === "lowercase") characters = characters.toLowerCase(); t.characters = characters; t.name = nodeName(node);
  t.x = px(node.x) - parentOrigin.x; t.y = px(node.y) - parentOrigin.y;
  t.fontSize = Math.max(1, px(styles.fontSize, 16));
  const cssLineHeight = String(styles.lineHeight == null ? "normal" : styles.lineHeight).trim().toLowerCase();
  const fontSizePx = Math.max(1, px(styles.fontSize, 16));
  const explicitLineHeight = cssLineHeight !== "normal" && cssLineHeight !== "";
  let lineHeight = px(node.exactLineHeight, 0);
  if (!lineHeight && explicitLineHeight) {
    if (/%$/.test(cssLineHeight)) lineHeight = fontSizePx * px(cssLineHeight) / 100;
    else if (/^-?[\d.]+$/.test(cssLineHeight)) lineHeight = fontSizePx * px(cssLineHeight, 1);
    else lineHeight = px(cssLineHeight, 0);
  }
  const normalSingleLineHeight = !explicitLineHeight && !/[\r\n]/.test(characters) ? Math.max(1, px(node.height, fontSizePx)) : 0;
  if (explicitLineHeight && lineHeight > 0) t.lineHeight = { unit: "PIXELS", value: lineHeight };
  else if (normalSingleLineHeight > 0) t.lineHeight = { unit: "PIXELS", value: normalSingleLineHeight };
  else t.lineHeight = { unit: "PERCENT", value: 100 };
  const letterSpacing = px(styles.letterSpacing); if (letterSpacing) t.letterSpacing = { unit: "PIXELS", value: letterSpacing };
  const fill = colorToPaint(styles.webkitTextFillColor || styles.color || node.color); if (fill) t.fills = [fill];
  if (styles.textAlign) t.textAlignHorizontal = ({ center: "CENTER", right: "RIGHT", justify: "JUSTIFIED" })[styles.textAlign] || "LEFT";
  if (String(styles.textDecoration).includes("underline")) t.textDecoration = "UNDERLINE"; else if (String(styles.textDecoration).includes("line-through")) t.textDecoration = "STRIKETHROUGH";
  let textWidth = Math.max(0.01, px(node.width, t.width || 1)) + 1;
  let textHeight = Math.max(0.01, px(node.height, t.height || 1)) + 0.5;
  const capturedLineHeight = lineHeight > 0 ? lineHeight : normalSingleLineHeight > 0 ? normalSingleLineHeight : Math.max(1, fontSizePx * 1.25);
  const capturedSingleLine = !/[\r\n]/.test(characters) && px(node.height, capturedLineHeight) <= capturedLineHeight * 1.35;
  let availableWidth = Math.max(.01, Number(parent.width) || textWidth);
  const sourceSingleChild = options.sourceChildCounts.get(parent) === 1;
  const wrapperSingleLine = !/[\r\n]/.test(characters) && Number(parent.height) > 0 && Number(parent.height) <= capturedLineHeight * 1.15;
  const intrinsicInline = !/[\r\n]/.test(characters) && ["inline", "inline-block", "inline-flex"].includes(String(styles.display || "").toLowerCase());
  const tightLineWrapper = (wrapperSingleLine || intrinsicInline) && styles.position !== "absolute" &&
    sourceSingleChild &&
    availableWidth <= px(node.width, textWidth) + 1.5 &&
    Number(parent.height) > 0 && Number(parent.height) <= px(node.height, textHeight) + 1;
  if (tightLineWrapper) {
    availableWidth = textWidth;
    textHeight = Math.max(1, Math.ceil(Number(parent.height)) + 1);
    t.x = 0; t.y = 0;
  }
  const singleFlexLabel = !/[\r\n]/.test(characters) && ["flex", "inline-flex"].includes(String(styles.display || "").toLowerCase()) &&
    sourceSingleChild && px(node.width, textWidth) < availableWidth - 1;
  const alignedBlockLabel = !/[\r\n]/.test(characters) && ["center", "right"].includes(styles.textAlign) &&
    sourceSingleChild && px(node.width, textWidth) < availableWidth - 4;
  const centeredGridGlyph = characters.length <= 2 && styles.display === "grid" &&
    styles.justifyItems === "center" && styles.alignItems === "center";
  if (centeredGridGlyph) {
    textWidth = Math.max(1, Math.ceil(px(node.width, t.width || 1)));
    t.textAlignHorizontal = "CENTER";
  }
  const isHeading = /^h[1-6](?:\b|\.)/i.test(String(parent.name || ""));
  const headingUsesBlockBox = isHeading && availableWidth > px(node.width, textWidth) + 4;
  const explicitLineBreaks = /[\r\n]/.test(characters);
  const centeredMultiline = explicitLineBreaks && styles.textAlign === "center";
  const intrinsicMultilineParagraph = explicitLineBreaks && node.mergedText && node.sourceTag === "p";
  const useAutoHeight = explicitLineBreaks ? (!centeredMultiline && !intrinsicMultilineParagraph) : (headingUsesBlockBox || (!capturedSingleLine && !tightLineWrapper && !singleFlexLabel && !alignedBlockLabel && !centeredGridGlyph));
  const desiredTextWidth = useAutoHeight ? availableWidth : textWidth;
  const desiredResize = useAutoHeight ? "HEIGHT" : "WIDTH_AND_HEIGHT";
  t.textAutoResize = "NONE"; t.resize(desiredTextWidth, Math.max(0.01, textHeight)); t.textAutoResize = desiredResize;
  if (options.localStyles && !centeredGridGlyph) {
    const manualId = options.textStyleMap[capturedTextSignature(styles, node)];
    const textStyle = manualId ? options.localStyles.texts.find(style => style.id === manualId) : options.useExistingStyles ? matchingTextStyle(options.localStyles.texts, t) : null;
    if (textStyle) {
      try {
        await applyResolvedTextStyle(t, textStyle);
        options.stats.textStyles++;
        t.textAutoResize = "NONE"; t.resize(desiredTextWidth, Math.max(.01, textHeight));
        t.textAutoResize = desiredResize;
      } catch (error) { warn(options, "TEXT_STYLE", `Could not apply text style to ${nodeName(node)}: ${error && error.message || error}`); }
    }
    else if (options.useExistingStyles && !(options.localStyles.texts || []).length) applyTypographyVariables(t, options.localVariables);
  }
  parent.appendChild(t);
  t.textAutoResize = desiredResize;
  return t;
}

function isIconTextNode(source, text) {
  const family=String((source && source.font) || (source && source.styles && source.styles.fontFamily) || (text && text.fontName && text.fontName.family) || "").toLowerCase();
  const chars=String(source && (source.value || source.text) || text && text.characters || "");
  return chars.length <= 2 && /(icon|symbol|glyph|awesome|material|lucide|feather|bootstrap|remix|phosphor|ionicons)/i.test(family);
}

async function makeNode(node, parent, parentOrigin, inheritedStyles, payload, options, depth = 0) {
  if (!node || typeof node !== "object") return null;
  options.stats.nodes++;
  await yieldImport(options);
  const type = String(node.type || node.kind || "FRAME").toUpperCase();
  if (type === "TEXT") {
    const textNode = await makeText(node, parent, parentOrigin, inheritedStyles, options);
    if (textNode && options.semanticNames) textNode.name = semanticLayerName(node);
    attachSourceMap(textNode, node, options, parentOrigin); recordGeometryAccuracy(textNode, node, parentOrigin, options);
    if (textNode && options.iconVectors && isIconTextNode(node, textNode)) {
      try { const outlined = textNode.outlineStroke(); outlined.name = `${textNode.name} / Vector`; attachSourceMap(outlined, node, options, parentOrigin); textNode.remove(); options.stats.iconVectors++; return outlined; }
      catch (error) { warn(options, "ICON_VECTOR", `Could not convert icon glyph on ${nodeName(node, options)}: ${error && error.message || error}`); }
    }
    return textNode;
  }
  if (type === "SVG" && node.svg) { try { const svg = figma.createNodeFromSvg(node.svg); svg.name = nodeName(node, options); positionAndSize(svg, node, parentOrigin); parent.appendChild(svg); attachSourceMap(svg, node, options, parentOrigin); recordGeometryAccuracy(svg, node, parentOrigin, options); return svg; } catch (error) { warn(options, "SVG", `SVG failed on ${nodeName(node)}: ${error && error.message || error}`); } }
  const frame = figma.createFrame(); frame.name = nodeName(node, options); frame.layoutMode = "NONE"; positionAndSize(frame, node, parentOrigin);
  await applyFrameStyle(frame, node, payload, options); parent.appendChild(frame); attachSourceMap(frame, node, options, parentOrigin); recordGeometryAccuracy(frame, node, parentOrigin, options);
  options.sourceChildCounts.set(frame, normalizedChildren(node).length);
  const frameEffects = (frame.effects || []).slice();
  const isolatedShadow = frameEffects.length && ((frame.fills || []).some(paint => String(paint.type).startsWith("GRADIENT")) || frameEffects.some(effect => effect.color && effect.color.a < .999));
  if (isolatedShadow) {
    frame.effects = [];
    const shadow = figma.createRectangle(); shadow.name = String(node.tag || "").toLowerCase() === "button" ? "Button:shadow" : "Overlay+Shadow";
    shadow.resize(frame.width, frame.height); shadow.x = frame.x; shadow.y = frame.y;
    shadow.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: .002 }]; shadow.effects = frameEffects;
    shadow.topLeftRadius = frame.topLeftRadius; shadow.topRightRadius = frame.topRightRadius; shadow.bottomRightRadius = frame.bottomRightRadius; shadow.bottomLeftRadius = frame.bottomLeftRadius;
    const frameIndex = parent.children.indexOf(frame); parent.insertChild(Math.max(0, frameIndex), shadow);
    if (parent.layoutMode && parent.layoutMode !== "NONE" && "layoutPositioning" in shadow) shadow.layoutPositioning = "ABSOLUTE";
    options.stats.nodes++;
  }
  const stylesForMask = node.styles || {};
  const visibleRadial = radialGradientPaint(stylesForMask.backgroundImage);
  const alphaMask = radialGradientPaint(stylesForMask.webkitMaskImage || stylesForMask.maskImage);
  if (visibleRadial && alphaMask) {
    frame.fills = [];
    const mask = figma.createRectangle(); mask.name = "Mask"; mask.resize(frame.width, frame.height); mask.fills = [alphaMask]; mask.isMask = true; try { mask.maskType = "ALPHA"; } catch (_) {}
    const visual = figma.createRectangle(); visual.name = "Gradient"; visual.resize(frame.width, frame.height); visual.fills = [visibleRadial]; visual.opacity = frame.opacity; frame.opacity = 1;
    frame.appendChild(mask); frame.appendChild(visual); options.stats.masks++; options.stats.gradients++; options.stats.nodes += 2;
  }
  const origin = { x: px(node.x), y: px(node.y) }, styles = node.styles || inheritedStyles || {};
  for (const child of orderedSourceChildren(node)) {
    const parentFlow = options.flowSpecs.get(frame);
    const spacerSpec = parentFlow && parentFlow.gapBefore && parentFlow.gapBefore.get(child);
    const spacerGap = spacerSpec && Number(spacerSpec.value);
    if (spacerGap > .5) {
      const spacer = figma.createFrame(); spacer.name = `${spacerSpec.kind || "Gap"} ${Math.round(spacerGap * 100) / 100}`; spacer.fills = []; spacer.layoutMode = "NONE";
      if (parentFlow && parentFlow.mode === "VERTICAL") {
        spacer.resize(.01, spacerGap);
      } else {
        spacer.resize(spacerGap, .01);
      }
      frame.appendChild(spacer); options.stats.nodes++;
    }
    const childNode = await makeNode(child, frame, origin, styles, payload, options, depth + 1);
    applyResponsiveConstraints(childNode, child, node, options);
    if (options.autoLayout && !options.flowFrames.has(frame) && !options.gridFrames.has(frame) && frame.layoutMode !== "NONE" && childNode && "layoutPositioning" in childNode) { childNode.layoutPositioning = "ABSOLUTE"; positionAndSize(childNode, child, origin); }
    if (options.gridFrames.has(frame) && childNode) {
      const gridSpec = options.gridSpecs.get(frame), cell = gridSpec && gridSpec.cellFor.get(child);
      if (cell) { try { frame.appendChildAt(childNode, cell.row, cell.col); } catch (error) { warn(options, "CSS_GRID", `Could not place ${nodeName(child, options)} in its grid cell: ${error && error.message || error}`); } }
    }
  }

  // -------- REMOVED the absolute-child safety check --------
  // Now we always commit layout if the frame has a flow or grid spec.

  // Commit Auto Layout for flex/block containers
  if (options.flowFrames.has(frame)) {
    try {
      const flowSpec = options.flowSpecs.get(frame);
      const border = borderWidths(styles.borderWidth);
      frame.layoutMode = flowSpec.mode;
      frame.primaryAxisSizingMode = "FIXED";
      frame.counterAxisSizingMode = "FIXED";
      frame.itemSpacing = Math.max(0, flowSpec.gap || 0);
      if (flowSpec.mode === "VERTICAL") {
        frame.paddingTop = Math.max(0, flowSpec.leading - border[0]);
        frame.paddingBottom = Math.max(0, flowSpec.trailing - border[2]);
        frame.paddingLeft = Math.max(0, flowSpec.crossStart - border[3]);
        frame.paddingRight = Math.max(0, flowSpec.crossTrailing - border[1]);
      } else {
        frame.paddingLeft = Math.max(0, flowSpec.leading - border[3]);
        frame.paddingRight = Math.max(0, flowSpec.trailing - border[1]);
        frame.paddingTop = Math.max(0, flowSpec.crossStart - border[0]);
        frame.paddingBottom = Math.max(0, flowSpec.crossTrailing - border[2]);
      }
      const justify = String(styles.justifyContent || "").toLowerCase();
      const align = String(styles.alignItems || "").toLowerCase();
      frame.primaryAxisAlignItems = ({ center: "CENTER", "space-between": "SPACE_BETWEEN", "flex-end": "MAX" })[justify] || "MIN";
      frame.counterAxisAlignItems = ({ center: "CENTER", "flex-end": "MAX", stretch: "MIN" })[align] || "MIN";
      for (const child of normalizedChildren(node)) {
        const sourceId = sourceNodeId(child);
        let childNode = options.sourceNodeMap ? options.sourceNodeMap.get(sourceId) : null;
        if (!childNode) {
          childNode = frame.children.find(n => n.getPluginData && n.getPluginData("h2d-source-id") === sourceId);
          if (childNode && options.sourceNodeMap) options.sourceNodeMap.set(sourceId, childNode);
        }
        if (!childNode || !("layoutGrow" in childNode)) continue;
        const childStyles = child.styles || {};
        const position = String(childStyles.position || "").toLowerCase();
        if ((position === "absolute" || position === "fixed") && "layoutPositioning" in childNode) {
          childNode.layoutPositioning = "ABSOLUTE";
          positionAndSize(childNode, child, { x: px(node.x), y: px(node.y) });
          continue;
        }
        const parentPrimaryProperty = flowSpec.mode === "VERTICAL" ? "height" : "width";
        const parentPrimaryValue = String(styles[parentPrimaryProperty] == null ? "auto" : styles[parentPrimaryProperty]).trim().toLowerCase();
        const parentPrimaryIsAuto = ["", "auto", "fit-content", "max-content", "min-content"].includes(parentPrimaryValue);
        childNode.layoutGrow = !parentPrimaryIsAuto && px(childStyles.flexGrow) > 0 ? 1 : 0;
        const crossStretch = childStyles.alignSelf === "stretch" || align === "stretch" ||
          (flowSpec.mode === "VERTICAL" && String(childStyles.width || "").trim() === "100%") ||
          (flowSpec.mode === "HORIZONTAL" && String(childStyles.height || "").trim() === "100%");
        childNode.layoutAlign = crossStretch ? "STRETCH" : "INHERIT";
      }
      options.stats.autoLayouts++;
    } catch (error) {
      try { frame.layoutMode = "NONE"; } catch (_) {}
      options.flowFrames.delete(frame);
      options.flowSpecs.delete(frame);
      warn(options, "AUTO_LAYOUT_FALLBACK", `Auto Layout failed safely on ${nodeName(node)}; kept captured pixel geometry: ${error && error.message || error}`);
    }
  }

  // Commit Grid layout
  if (options.gridFrames.has(frame)) {
    try {
      const gridSpec = options.gridSpecs.get(frame);
      const border = borderWidths(styles.borderWidth);
      frame.layoutMode = "GRID";
      frame.gridRowCount = gridSpec.rowCount;
      frame.gridColumnCount = gridSpec.colCount;
      frame.gridRowGap = Math.max(0, gridSpec.rowGap);
      frame.gridColumnGap = Math.max(0, gridSpec.colGap);
      for (let i = 0; i < Math.min(gridSpec.rowSizes.length, 24); i++) {
        try { frame.gridRowSizes[i].type = "FIXED"; frame.gridRowSizes[i].value = Math.max(1, gridSpec.rowSizes[i]); } catch (_) {}
      }
      for (let i = 0; i < Math.min(gridSpec.colSizes.length, 24); i++) {
        try { frame.gridColumnSizes[i].type = "FIXED"; frame.gridColumnSizes[i].value = Math.max(1, gridSpec.colSizes[i]); } catch (_) {}
      }
      frame.paddingTop = Math.max(0, gridSpec.paddingTop - border[0]);
      frame.paddingRight = Math.max(0, gridSpec.paddingRight - border[1]);
      frame.paddingBottom = Math.max(0, gridSpec.paddingBottom - border[2]);
      frame.paddingLeft = Math.max(0, gridSpec.paddingLeft - border[3]);
      if (gridSpec.areaMap) {
        try { frame.setPluginData("h2d-grid-areas", JSON.stringify(gridSpec.areaMap)); } catch (_) {}
      }
      options.stats.grids++;
    } catch (error) {
      try { frame.layoutMode = "NONE"; } catch (_) {}
      options.gridFrames.delete(frame);
      options.gridSpecs.delete(frame);
      warn(options, "CSS_GRID", `Grid commit failed on ${nodeName(node)}; kept pixel geometry: ${error && error.message || error}`);
    }
  }

  // Fallback warning if layout was requested but couldn't be applied (only if autoLayout is true)
  if (options.autoLayout && styles.display && ["flex", "block", "grid"].includes(String(styles.display).toLowerCase()) && !options.flowFrames.has(frame) && !options.gridFrames.has(frame) && normalizedChildren(node).some(c => !["absolute", "fixed"].includes(String(c.styles && c.styles.position || "").toLowerCase()))) {
    warn(options, "AUTO_LAYOUT_FALLBACK", `Layout kept pixel-positioned for safety: ${nodeName(node)}`);
  }

  // Hug sizing for flow containers (already applied)
  if (options.flowFrames.has(frame)) {
    const flow = options.flowSpecs.get(frame), primaryProperty = frame.layoutMode === "VERTICAL" ? "height" : "width";
    const counterProperty = frame.layoutMode === "VERTICAL" ? "width" : "height";
    const automatic = value => value == null || value === "" || ["auto", "fit-content", "max-content", "min-content"].includes(String(value).trim().toLowerCase());
    const distributedPrimary = ["space-between", "space-around", "space-evenly"].includes(String(styles.justifyContent || "").toLowerCase());
    const pinnedFlow = ["absolute", "fixed"].includes(String(styles.position || "").toLowerCase());
    const scrollingFlow = [styles.overflow, styles.overflowX, styles.overflowY].some(value => ["auto", "scroll"].includes(String(value || "").toLowerCase()));
    if (automatic(styles[primaryProperty]) && !distributedPrimary && !pinnedFlow && !scrollingFlow) {
      try { frame.primaryAxisSizingMode = "AUTO"; } catch (_) {}
      if (!options.useExistingStyles) {
        const targetPrimary = frame.layoutMode === "VERTICAL" ? px(node.height) : px(node.width);
        const actualPrimary = frame.layoutMode === "VERTICAL" ? frame.height : frame.width;
        const drift = actualPrimary - targetPrimary;
        if (drift > .05 && drift <= 4) {
          if (frame.layoutMode === "VERTICAL" && frame.paddingBottom >= drift) frame.paddingBottom -= drift;
          else if (frame.layoutMode === "HORIZONTAL" && frame.paddingRight >= drift) frame.paddingRight -= drift;
          else {
            const spacers = frame.children.filter(child => /^(?:Gap|Margin) /.test(child.name));
            const spacer = spacers.sort((a, b) => (frame.layoutMode === "VERTICAL" ? b.height - a.height : b.width - a.width))[0];
            if (spacer) {
              if (frame.layoutMode === "VERTICAL" && spacer.height > drift) spacer.resize(spacer.width, spacer.height - drift);
              else if (frame.layoutMode === "HORIZONTAL" && spacer.width > drift) spacer.resize(spacer.width - drift, spacer.height);
            }
          }
        }
      }
    }
    const crossSlack = flow ? flow.crossStart + flow.crossTrailing : Infinity;
    if (automatic(styles[counterProperty]) && crossSlack <= 2 && !frame.clipsContent) {
      try { frame.counterAxisSizingMode = "AUTO"; } catch (_) {}
    }
  }
  return frame;
}

function componentPaintSignature(paints) {
  return (paints || []).map(paint => ({ type: paint.type, opacity: rounded(paint.opacity == null ? 1 : paint.opacity), color: paint.color || null, imageHash: paint.imageHash || null, scaleMode: paint.scaleMode || null, stops: paint.gradientStops || null }));
}

function componentDimension(value) { return Math.round(Number(value || 0) * 2) / 2; }
function textOnlySubtree(node) { return node.type === "TEXT" || ("children" in node && node.children.length > 0 && node.children.every(textOnlySubtree)); }

function semanticComponentName(name) {
  return String(name || "").toLowerCase().replace(/\.(?:active|selected|checked|current|open|disabled|hover|focus)(?=\.|$)/g, "").replace(/\s+/g, " ").trim();
}

function componentDisplayName(name) {
  const clean = semanticComponentName(name).replace(/^[a-z][a-z0-9-]*(?:#[-\w]+)?\.?/i, "").replace(/[.#_-]+/g, " ").trim() || "Default";
  return clean.replace(/\b\w/g, letter => letter.toUpperCase());
}

function componentStructureFingerprint(node) {
  if (!node || node.removed) return "";
  if (node.type === "TEXT") return "TEXT";
  const children = "children" in node ? node.children.filter(child => !/^(?:Gap|Margin)\s/i.test(child.name || "")).map(componentStructureFingerprint) : [];
  return JSON.stringify({ type: node.type, name: semanticComponentName(node.name), layout: node.layoutMode || "NONE", children });
}

function componentFingerprint(node, smartText) {
  if (!node || node.removed) return "";
  if (node.type === "TEXT") return JSON.stringify({ type: "TEXT", name: smartText ? "*" : node.name, text: smartText ? "*" : node.characters, width: smartText ? "*" : rounded(node.width), height: smartText ? "*" : rounded(node.height), auto: node.textAutoResize, font: node.fontName, size: node.fontSize, line: node.lineHeight, spacing: node.letterSpacing, align: node.textAlignHorizontal, fills: componentPaintSignature(node.fills) });
  const children = "children" in node ? node.children.map(child => componentFingerprint(child, smartText)) : [];
  let width = componentDimension(node.width), height = componentDimension(node.height);
  if (smartText) {
    if (textOnlySubtree(node)) { width = "*"; height = "*"; }
    else if (node.layoutMode === "HORIZONTAL") { if (node.primaryAxisSizingMode === "AUTO") width = "*"; if (node.counterAxisSizingMode === "AUTO") height = "*"; }
    else if (node.layoutMode === "VERTICAL") { if (node.primaryAxisSizingMode === "AUTO") height = "*"; if (node.counterAxisSizingMode === "AUTO") width = "*"; }
  }
  return JSON.stringify({ type: node.type, name: node.name, width, height, opacity: rounded(node.opacity), visible: node.visible, fills: componentPaintSignature(node.fills), strokes: componentPaintSignature(node.strokes), effects: (node.effects || []).map(normalizedEffect), radii: [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius].map(rounded), layout: node.layoutMode || "NONE", sizing: [node.primaryAxisSizingMode, node.counterAxisSizingMode], spacing: node.itemSpacing, padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft], align: [node.primaryAxisAlignItems, node.counterAxisAlignItems], clips: node.clipsContent, children });
}

function componentCandidate(node, roots) {
  if (!node || !["FRAME", "RECTANGLE", "ELLIPSE"].includes(node.type) || roots.includes(node)) return false;
  if (node.width < 24 || node.height < 16 || /^(?:Gap|Margin)\s|^(?:html|body)$/i.test(node.name || "") || /^::/.test(node.name || "")) return false;
  const name = String(node.name || ""), control = /^(?:button|input|select|textarea|a)(?:\.|$)/i.test(name), media = /^(?:img|image|figure)(?:[.#]|$)/i.test(name);
  if (/^(?:h[1-6]|p|strong|span)(?:[.#]|$)/i.test(name)) return false;
  if (!control && !media && (!("children" in node) || node.children.length < 2 || subtreeSize(node) < 6)) return false;
  return !("findOne" in node) || !node.findOne(child => child.type === "COMPONENT");
}

function fullComponentCandidate(node, roots) {
  if (!node || !["FRAME", "RECTANGLE", "ELLIPSE"].includes(node.type) || roots.includes(node)) return false;
  const name = String(node.name || ""), lower = name.toLowerCase();
  if (node.width < 16 || node.height < 12 || /^(?:Gap|Margin)\s|^::/.test(name)) return false;
  if (/^(?:html|body|main(?:\.app)?|\d+w\s|Generated Components)/i.test(name)) return false;
  if (/^(?:h[1-6]|p|strong|span)(?:[.#]|$)/i.test(name)) return false;
  if (lower === "div" || lower === "section" || lower === "svg") return false;
  if ("findOne" in node && node.findOne(child => child.type === "COMPONENT")) return false;
  const namedBlock = /[.#]/.test(name) || /^(?:button|input|select|textarea|a|img|image|figure|nav|header|footer|aside|form|label|svg)(?:[.#]|$)/i.test(name);
  return namedBlock || ("children" in node && node.children.length >= 2 && subtreeSize(node) >= 6);
}

function subtreeSize(node) { return 1 + ("children" in node ? node.children.reduce((sum, child) => sum + subtreeSize(child), 0) : 0); }

function copyInstanceOverrides(source, target) {
  if (source.type === "TEXT" && target.type === "TEXT") { try { target.characters = source.characters; } catch (_) {} }
  for (const property of ["fills", "strokes", "effects", "opacity", "blendMode", "cornerRadius", "topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"]) copyComponentProperty(source, target, property);
  if (!("children" in source) || !("children" in target) || source.children.length !== target.children.length) return;
  for (let i = 0; i < source.children.length; i++) copyInstanceOverrides(source.children[i], target.children[i]);
}

function replaceWithInstance(node, component, copyText) {
  const parent = node.parent; if (!parent || !("children" in parent)) return null;
  const index = parent.children.indexOf(node), placement = { x: node.x, y: node.y, layoutPositioning: node.layoutPositioning, layoutGrow: node.layoutGrow, layoutAlign: node.layoutAlign, constraints: node.constraints };
  const instance = component.createInstance(); instance.name = node.name;
  if (copyText) copyInstanceOverrides(node, instance);
  parent.insertChild(Math.max(0, index), instance);
  try { instance.layoutPositioning = placement.layoutPositioning; } catch (_) {}
  try { instance.layoutGrow = placement.layoutGrow; } catch (_) {}
  try { instance.layoutAlign = placement.layoutAlign; } catch (_) {}
  try { instance.constraints = placement.constraints; } catch (_) {}
  if (!parent.layoutMode || parent.layoutMode === "NONE" || placement.layoutPositioning === "ABSOLUTE") { instance.x = placement.x; instance.y = placement.y; }
  node.remove(); return instance;
}

function copyComponentProperty(source, target, property) {
  if (!(property in source) || !(property in target)) return;
  try { target[property] = source[property]; } catch (_) {}
}

function createComponentMaster(source) {
  const component = figma.createComponent();
  component.name = source.name;
  try { component.resizeWithoutConstraints(source.width, source.height); } catch (_) { component.resize(source.width, source.height); }
  const visualProperties = [
    "fills", "strokes", "strokeWeight", "strokeTopWeight", "strokeRightWeight",
    "strokeBottomWeight", "strokeLeftWeight", "strokeAlign", "strokeJoin",
    "dashPattern", "effects", "opacity", "blendMode", "isMask", "clipsContent",
    "cornerRadius", "topLeftRadius", "topRightRadius", "bottomRightRadius",
    "bottomLeftRadius", "constraints"
  ];
  for (const property of visualProperties) copyComponentProperty(source, component, property);
  if ("children" in source) for (const child of source.children) component.appendChild(child.clone());
  const layoutProperties = [
    "layoutMode", "layoutWrap", "primaryAxisSizingMode", "counterAxisSizingMode",
    "primaryAxisAlignItems", "counterAxisAlignItems", "counterAxisAlignContent",
    "itemSpacing", "counterAxisSpacing", "paddingTop", "paddingRight",
    "paddingBottom", "paddingLeft", "strokesIncludedInLayout",
    "itemReverseZIndex", "minWidth", "maxWidth", "minHeight", "maxHeight"
  ];
  for (const property of layoutProperties) copyComponentProperty(source, component, property);
  return component;
}

function createComponentLibrary(roots, filename) {
  const frame = figma.createFrame(); frame.name = `Generated Components — ${String(filename || "capture.h2d").replace(/\.[^.]+$/, "")}`; frame.layoutMode = "VERTICAL"; frame.primaryAxisSizingMode = "AUTO"; frame.counterAxisSizingMode = "FIXED"; frame.itemSpacing = 24; frame.paddingTop = 24; frame.paddingRight = 24; frame.paddingBottom = 24; frame.paddingLeft = 24; frame.fills = [{ type: "SOLID", color: { r: .12, g: .12, b: .12 } }]; frame.cornerRadius = 16; frame.clipsContent = false; frame.resize(440, 100);
  frame.x = Math.max(...roots.map(root => root.x + root.width)) + 120; frame.y = Math.min(...roots.map(root => root.y)); figma.currentPage.appendChild(frame); return frame;
}

function generateComponents(roots, filename, smartText, componentMode, stateVariants = false) {
  const complete = componentMode === "complete";
  const all = []; for (const root of roots) all.push(...root.findAll(node => complete ? fullComponentCandidate(node, roots) : componentCandidate(node, roots)));
  const groups = new Map(); for (const node of all) {
    const state = stateVariants ? String(node.name || "").match(/(?:\.|\s|\/)(active|selected|checked|current|open|disabled|hover|focus|loading|error|success)(?:$|\.)/i) : null;
    const stateKey = state ? `|STATE:${state[1].toLowerCase()}` : "";
    const key = (smartText ? componentStructureFingerprint(node) : componentFingerprint(node, false)) + stateKey;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(node);
  }
  const repeatedCount = [...groups.values()].filter(nodes => nodes.length > 1).length;
  const selected = [...groups.values()].filter(nodes => complete || nodes.length > 1 || (stateVariants && nodes.some(node => /(?:\.|\s|\/)(active|selected|checked|current|open|disabled|hover|focus|loading|error|success)(?:$|\.)/i.test(String(node.name || ""))))).sort((a, b) => complete ? subtreeSize(a[0]) - subtreeSize(b[0]) : subtreeSize(b[0]) - subtreeSize(a[0]));
  let library = null, components = 0, instances = 0, failures = 0; const blocked = new Set(), masters = [];
  for (const originalGroup of selected) {
    if (components >= (complete ? 120 : 40)) break;
    const group = originalGroup.filter(node => !node.removed && node.parent && !blocked.has(node.id)); if (group.length < (complete ? 1 : 2)) continue;
    const first = group[0];
    let component; try { component = createComponentMaster(first); } catch (_) { failures++; continue; }
    for (const node of group) {
      blocked.add(node.id);
      if (!complete && "findAll" in node) for (const child of node.findAll(() => true)) blocked.add(child.id);
    }
    const rawName = String(first.name || `Component ${components + 1}`), category = /^(?:img|image|figure)/i.test(rawName) ? "Media" : /^(?:button|input|select|textarea|a)/i.test(rawName) ? "Control" : "Block";
    const stateMatch = rawName.match(/(?:\.|\s|\/)(active|selected|checked|current|open|disabled|hover|focus|loading|error|success)(?:$|\.)/i);
    const baseName = componentDisplayName(rawName);
    component.name = `${category} / ${baseName}${stateVariants && stateMatch ? `, State=${stateMatch[1][0].toUpperCase()+stateMatch[1].slice(1).toLowerCase()}` : ""}`;
    masters.push({component, base:`${category} / ${baseName}`});
    if (!library) library = createComponentLibrary(roots, filename); library.appendChild(component); library.resize(Math.max(library.width, component.width + 48), library.height); components++; instances++;
    instances--;
    for (const node of group) if (replaceWithInstance(node, component, smartText)) instances++;
  }
  if (stateVariants && library && typeof figma.combineAsVariants === "function") {
    const byBase = new Map(); for (const item of masters) { if (!item.component.name.includes(", State=")) continue; if (!byBase.has(item.base)) byBase.set(item.base, []); byBase.get(item.base).push(item.component); }
    for (const variants of byBase.values()) if (variants.length > 1) { try { const set=figma.combineAsVariants(variants, library); set.name=variants[0].name.split(", State=")[0]; } catch (_) { failures++; } }
  }
  const standalone = complete ? selected.filter(nodes => nodes.length === 1).length : 0, screens = 0;
  if (library && !components) library.remove();
  return { components, instances, failures, candidates: all.length, repeated: repeatedCount, standalone, screens, library };
}

async function updateSelectedImport(payload, filename, options, view) {
  const selected=figma.currentPage.selection || [];
  const target=selected.length===1 ? selected[0] : null;
  if (!target || target.type !== "FRAME" || target.getPluginData("h2d-import-root") !== "1") throw new Error("Select one H2D imported frame to update.");
  const oldX=target.x, oldY=target.y, oldName=target.name;
  const source=view && view.frame || payload.frame || payload.root || payload.document || payload;
  const copy={...payload, frame:source};
  const temp=await importPayload(copy, filename, options, 0, view);
  const oldChildren=[...target.children];
  const children=[...temp.children];
  try {
    for (const child of oldChildren) child.remove();
    for (const child of children) target.appendChild(child);
    target.resize(temp.width, temp.height); target.fills=temp.fills; target.clipsContent=temp.clipsContent;
    target.setPluginData("h2d-source-file",String(filename||"")); target.setPluginData("h2d-build",BUILD_VERSION);
    temp.remove(); target.x=oldX; target.y=oldY; target.name=oldName; options.stats.updated=1; return target;
  } catch (error) { throw new Error(`Re-import mapping failed safely: ${error && error.message || error}`); }
}

function optimizeFrameHierarchy(root, options) {
  if (!root || !("findAll" in root)) return 0;
  let removed = 0;
  const frames = root.findAll(node =>
    node.type === "FRAME" &&
    node.getPluginData("h2d-import-root") !== "1" &&
    !node.parent?.type === "COMPONENT"
  ).reverse();
  for (const frame of frames) {
    if (frame.removed || !frame.parent) continue;
    const hasVisibleFill = (frame.fills || []).some(f => f.opacity > 0.01);
    const hasVisibleStroke = (frame.strokes || []).length > 0 && (frame.strokeWeight || 0) > 0;
    const hasVisual = hasVisibleFill || hasVisibleStroke ||
                      (frame.effects?.length > 0) ||
                      frame.clipsContent ||
                      frame.opacity < 0.99 ||
                      (frame.cornerRadius && frame.cornerRadius > 0);
    if (hasVisual) continue;

    const hasLayout = frame.layoutMode !== "NONE" ||
                      frame.paddingTop > 0 ||
                      frame.paddingRight > 0 ||
                      frame.paddingBottom > 0 ||
                      frame.paddingLeft > 0 ||
                      frame.itemSpacing > 0;
    if (hasLayout) continue;
    if (/^(?:Gap|Margin) /.test(frame.name)) continue;

    const children = frame.children;
    if (children.length === 1) {
      const child = children[0];
      if (child.type === "TEXT") {
        const hasTextWrapperStyles = frame.paddingTop > 0 || frame.paddingRight > 0 ||
                                     frame.paddingBottom > 0 || frame.paddingLeft > 0 ||
                                     frame.layoutMode !== "NONE";
        if (hasTextWrapperStyles) continue;
      }
      const parent = frame.parent;
      const index = parent.children.indexOf(frame);
      const x = frame.x + child.x;
      const y = frame.y + child.y;
      parent.insertChild(index, child);
      if (parent.layoutMode === "NONE") {
        child.x = x;
        child.y = y;
      } else {
        try { child.layoutPositioning = frame.layoutPositioning || "ABSOLUTE"; } catch (_) {}
      }
      try { child.constraints = frame.constraints; } catch (_) {}
      frame.remove();
      removed++;
      options.stats.flattenedWrappers = (options.stats.flattenedWrappers || 0) + 1;
    }
  }
  return removed;
}

function fitRootToChildren(root, padding) {
  if (!root || root.children.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const child of root.children) {
    if (child.removed) continue;
    const x = child.x, y = child.y, w = child.width, h = child.height;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  if (!isFinite(minX)) return;
  const offsetX = padding - minX;
  const offsetY = padding - minY;
  for (const child of root.children) {
    child.x += offsetX;
    child.y += offsetY;
  }
  const newWidth = Math.max(1, maxX - minX + padding * 2);
  const newHeight = Math.max(1, maxY - minY + padding * 2);
  root.resize(newWidth, newHeight);
}

async function importPayload(payload, filename, options, offsetX, view) {
  const source = payload.frame || (payload.root || payload.document || payload); if (!source || typeof source !== "object") throw new Error("Decoded file has no frame data");
  const canvasWidth = Math.max(1, px(view && view.artboardWidth, source.width || 1440));
  const canvasHeight = Math.max(1, px(view && view.artboardHeight, source.height || 900));
  const captureWidth = Math.max(1, px(view && view.captureWidth, payload.width || canvasWidth));
  const theme = String(view && view.theme || payload.theme || "default");
  const padding = 100;
  const sourceTitle = payload.url || payload.name || String(filename || "Imported H2D").replace(/\.[^.]+$/, "");
  const root = figma.createFrame(); root.name = `${sourceTitle} — ${filename || "capture.h2d"} by H2D Local Importer`; root.layoutMode = "NONE"; root.fills = [{ type: "SOLID", color: { r: 0.27, g: 0.27, b: 0.27 } }]; root.clipsContent = true;
  root.resize(canvasWidth + padding * 2, canvasHeight + padding * 2); root.x = offsetX || 0; root.setPluginData("h2d-import-root", "1"); root.setPluginData("h2d-source-file", String(filename || "")); root.setPluginData("h2d-build",BUILD_VERSION); root.setPluginData("h2d-capture",JSON.stringify({width:captureWidth,height:canvasHeight,theme})); figma.currentPage.appendChild(root);
  if (options.rollbackNodes) options.rollbackNodes.push(root);
  options.sourceNodeMap = new Map();
  const canvasNode = await makeNode(source, root, { x: px(source.x) - padding, y: px(source.y) - padding }, source.styles || {}, payload, options);
  if (canvasNode) { canvasNode.name = `${Math.round(captureWidth)}w ${theme}`; if ("clipsContent" in canvasNode) canvasNode.clipsContent = true; compactIconWrappers(canvasNode,options); optimizeFrameHierarchy(canvasNode, options); }
  fitRootToChildren(root, padding);
  figma.currentPage.selection = [root]; figma.viewport.scrollAndZoomIntoView([root]); return root;
}

function compactIconWrappers(root,options) {
  if(!root||!("findAll" in root))return 0;let removed=0;
  const iconLike=node=>node&&/^(?:Icon(?:\s*\/|$)|icon[-_.\s/]|svg(?:[-_.\s/]|$))/i.test(String(node.name||""));
  const neutral=node=>node&&["FRAME","GROUP"].includes(node.type)&&!(node.fills||[]).length&&!(node.strokes||[]).length&&!(node.effects||[]).length&&node.opacity===1&&!node.clipsContent&&Math.abs(Number(node.rotation||0))<.001;
  const usefulName=names=>{for(const name of names){const cleaned=titleWords(String(name||"").replace(/^Icon\s*\/\s*/i,"").replace(/^icon[-_.\s/]*/i,"").replace(/^svg[-_.\s/]*/i,"").replace(/\b(icon|svg|symbol|glyph)\b/ig," "));if(cleaned&& !/^(Icon|Default|Frame)$/i.test(cleaned))return `Icon / ${cleaned}`;}return "Icon";};
  for(const node of root.findAll(item=>["FRAME","GROUP"].includes(item.type)).reverse()){
    if(node.removed||!node.parent||!iconLike(node)||node.children.length!==1)continue;const child=node.children[0];if(!iconLike(child)||!neutral(child)||!("children" in child))continue;
    const sameBounds=Math.abs(child.x)<=1&&Math.abs(child.y)<=1&&Math.abs(child.width-node.width)<=1&&Math.abs(child.height-node.height)<=1;if(!sameBounds)continue;
    const originalWidth=node.width,originalHeight=node.height,grandchildren=[...child.children],name=usefulName([node.name,child.name]);
    try{if(node.type==="FRAME"&&node.layoutMode!=="NONE")node.layoutMode="NONE";for(const grandchild of grandchildren){const x=child.x+grandchild.x,y=child.y+grandchild.y;node.appendChild(grandchild);grandchild.x=x;grandchild.y=y;}child.remove();if("resize" in node)node.resize(originalWidth,originalHeight);node.name=name;removed++;}catch(_){}
  }
  if(options){options.stats.iconWrappersRemoved=(options.stats.iconWrappersRemoved||0)+removed;if(removed)warn(options,"ICON_CLEANUP",`${removed} redundant icon wrapper${removed>1?"s":""} collapsed safely.`);}return removed;
}

function countSourceNodes(node) { let count = 1; for (const child of node && node.children || []) count += countSourceNodes(child); return count; }

function layoutDiagnostics(views) {
  const result = { safe: 0, complexFlex: 0, grids: 0, safeGrids: 0, complexGrids: 0, overlays: 0, total: 0, svg:0, images:0, masks:0, gradients:0, shadows:0, transforms:0, pseudo:0, filters:0, explicitZ:0 };
  function walk(node) {
    const s = node.styles || {}, children = node.children || [];
    if (s.display === "flex") { result.total++; if (autoLayoutSpec(node)) result.safe++; else { result.complexFlex++; if (children.some((a, i) => children.some((b, j) => j > i && Number(a.x) < Number(b.x) + Number(b.width) && Number(a.x) + Number(a.width) > Number(b.x) && Number(a.y) < Number(b.y) + Number(b.height) && Number(a.y) + Number(a.height) > Number(b.y)))) result.overlays++; } }
    else if (s.display === "grid") { result.total++; result.grids++; if (autoLayoutSpec(node) || gridLayoutSpec(node)) result.safeGrids++; else result.complexGrids++; }
    const type=String(node.type||node.kind||"").toUpperCase(),tag=String(node.tag||node.name||"").toLowerCase();
    if(type==="SVG"||tag==="svg")result.svg++;if(type==="IMAGE"||/^(img|picture|video)$/.test(tag)||node.$url||(node.attr&&node.attr.src))result.images++;
    if(s.maskImage||s.webkitMaskImage)result.masks++;if(/gradient\(/i.test(String(s.backgroundImage||"")))result.gradients++;if(s.boxShadow&&s.boxShadow!=="none")result.shadows++;
    if(s.transform&&s.transform!=="none")result.transforms++;if(/::?(before|after)$/.test(tag))result.pseudo++;if(s.filter&&s.filter!=="none")result.filters++;if(s.zIndex!=null&&!['','auto'].includes(String(s.zIndex).toLowerCase()))result.explicitZ++;
    for (const child of children) walk(child);
  }
  for (const view of views || []) walk(view.frame || view);
  return result;
}

function accuracyReport(options) {
  const accuracy=options && options.accuracy || {count:0,positionError:0,sizeError:0}, count=Math.max(1,accuracy.count);
  const position=Math.max(0,Math.round((100-Math.min(100,accuracy.positionError/count*4))*10)/10);
  const size=Math.max(0,Math.round((100-Math.min(100,accuracy.sizeError/count*4))*10)/10);
  const fidelityWarnings=(options && options.warnings || []).filter(w=>/TEXT|FONT|IMAGE|SVG|FILTER|MASK|GRADIENT|AUTO_LAYOUT/.test(w.code)).reduce((sum,w)=>sum+(w.count||1),0);
  const overall=Math.max(0,Math.round(((position+size)/2-Math.min(25,fidelityWarnings*.35))*10)/10);
  return {overall,position,size,layers:accuracy.count,warnings:fidelityWarnings};
}

function rollbackImport(options) {
  if (!options) return;
  for (const node of [...(options.rollbackNodes||[])].reverse()) try { if (node && !node.removed && node.parent) node.remove(); } catch (_) {}
  for (const page of [...(options.rollbackPages||[])].reverse()) try { if (page && !page.removed && page.parent) page.remove(); } catch (_) {}
  try { if (options.originalPage && options.originalPage.parent) figma.currentPage=options.originalPage; } catch (_) {}
}

function selectedImportedNode() { const selected=figma.currentPage.selection||[]; return selected.length===1 ? selected[0] : null; }

function inspectImportedSelection() {
  const node=selectedImportedNode(); if(!node) throw new Error("Select one imported layer first.");
  let source=null; try{source=JSON.parse(node.getPluginData("h2d-source-geometry")||"null");}catch(_){}
  const current={x:rounded(node.x),y:rounded(node.y),width:rounded(node.width),height:rounded(node.height)};
  const delta=source?{x:rounded(current.x-source.x),y:rounded(current.y-source.y),width:rounded(current.width-source.width),height:rounded(current.height-source.height)}:null;
  return {name:node.name,type:node.type,sourceId:node.getPluginData("h2d-source-id")||null,source,current,delta,build:node.getPluginData("h2d-build")||null};
}

function repairSelectedGeometry() {
  const node=selectedImportedNode(); if(!node) throw new Error("Select one imported layer first.");
  let source=null; try{source=JSON.parse(node.getPluginData("h2d-source-geometry")||"null");}catch(_){}
  if(!source) throw new Error("This layer has no H2D source geometry mapping.");
  try { if("resize" in node) node.resize(Math.max(.01,source.width),Math.max(.01,source.height)); node.x=source.x; node.y=source.y; }
  catch (error) { throw new Error(`Could not reposition this layer directly (it's likely placed by Auto Layout/Grid, not free positioning): ${error && error.message || error}`); }
  return inspectImportedSelection();
}

function designSystemSummary() {
  const root=selectedImportedNode(); if(!root) throw new Error("Select one imported artboard or layer first.");
  const nodes=[root,...("findAll" in root?root.findAll(()=>true):[])],colors=new Set(),fonts=new Set(),radii=new Set(),shadows=new Set(),spacing=new Set(),images=new Set();
  for(const node of nodes){for(const p of node.fills||[]){if(p.type==="SOLID"&&p.color)colors.add(`${rounded(p.color.r)}:${rounded(p.color.g)}:${rounded(p.color.b)}:${rounded(p.opacity==null?1:p.opacity)}`);if(p.type==="IMAGE"&&p.imageHash)images.add(p.imageHash)}if(node.type==="TEXT"&&node.fontName!==figma.mixed)fonts.add(`${node.fontName.family}/${node.fontName.style}/${rounded(node.fontSize)}`);for(const r of [node.topLeftRadius,node.topRightRadius,node.bottomRightRadius,node.bottomLeftRadius])if(Number(r)>0)radii.add(rounded(r));for(const e of node.effects||[])if(/SHADOW/.test(e.type))shadows.add(JSON.stringify(normalizedEffect(e)));if(node.layoutMode&&node.layoutMode!=="NONE")for(const value of [node.itemSpacing,node.paddingTop,node.paddingRight,node.paddingBottom,node.paddingLeft])if(Number(value)>0)spacing.add(rounded(value));}
  return {layers:nodes.length,colors:colors.size,typography:fonts.size,spacing:spacing.size,radii:radii.size,shadows:shadows.size,images:images.size};
}

function cleanSelectedImport() {
  const root=selectedImportedNode(); if(!root||!("findAll" in root)) throw new Error("Select one imported artboard first.");
  let emptyRemoved=0,wrappersFlattened=0,hidden=0; const nodes=root.findAll(()=>true).reverse();
  for(const node of nodes){if(node.removed||!node.parent)continue;if(node.visible===false){hidden++;continue}if(node.type!=="FRAME"||node.getPluginData("h2d-import-root")==="1")continue;const visual=(node.fills||[]).length||(node.strokes||[]).length||(node.effects||[]).length||node.clipsContent;if(!visual&&!node.children.length&&!/^(?:Gap|Margin) /i.test(node.name)){node.remove();emptyRemoved++;continue}const generic=/^(?:div|span|frame|wrapper|container)(?:[ .#/]|$)/i.test(node.name);if(!visual&&generic&&node.layoutMode==="NONE"&&node.children.length===1){const child=node.children[0];if(Math.abs(child.x)<.1&&Math.abs(child.y)<.1&&Math.abs(child.width-node.width)<.1&&Math.abs(child.height-node.height)<.1){const parent=node.parent,index=parent.children.indexOf(node),x=node.x,y=node.y;parent.insertChild(index,child);child.x=x;child.y=y;node.remove();wrappersFlattened++;}}}
  return {emptyRemoved,wrappersFlattened,hiddenDetected:hidden};
}

let activeImport = null;
const PREFS_KEY = "h2d-import-prefs";

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === "cancel-import") { if (activeImport) activeImport.cancelled = true; return; }
    if (msg.type === "request-prefs") {
      let prefs = null; try { prefs = await figma.clientStorage.getAsync(PREFS_KEY); } catch (_) {}
      figma.ui.postMessage({ type: "prefs", prefs: prefs || null }); return;
    }
    if (msg.type === "save-prefs") {
      try { await figma.clientStorage.setAsync(PREFS_KEY, msg.prefs || {}); } catch (_) {}
      return;
    }
    if (msg.type === "request-fonts") { const fonts = await figma.listAvailableFontsAsync(); figma.ui.postMessage({ type: "fonts", families: [...new Set(fonts.map(f => f.fontName.family))].sort() }); return; }
    if (msg.type === "request-local-styles") { const styles = await figma.getLocalTextStylesAsync(); const variables = figma.variables ? await figma.variables.getLocalVariablesAsync() : []; figma.ui.postMessage({ type: "local-text-styles", styles: styles.map(style => ({ id: style.id, name: style.name, family: style.fontName.family, style: style.fontName.style, size: style.fontSize, boundFields: Object.keys(style.boundVariables || {}) })), variables: variables.map(variable => ({ id: variable.id, name: variable.name, scopes: variable.scopes || [], type: variable.resolvedType })) }); return; }
    if (msg.type === "analyze-layout") { figma.ui.postMessage({ type: "layout-diagnostics", data: layoutDiagnostics(msg.views) }); return; }
    if (msg.type === "inspect-selected") { figma.ui.postMessage({type:"inspection",data:inspectImportedSelection()}); return; }
    if (msg.type === "repair-selected") { figma.ui.postMessage({type:"inspection",data:repairSelectedGeometry(),repaired:true}); figma.notify("Selected layer geometry repaired"); return; }
    if (msg.type === "detect-design-system") { figma.ui.postMessage({type:"design-system-summary",data:designSystemSummary()}); return; }
    if (msg.type === "clean-selected") { const data=cleanSelectedImport(); figma.ui.postMessage({type:"cleanup-report",data}); figma.notify("H2D cleanup complete"); return; }
    if (msg.type === "update-selected") {
      const useExistingStyles = !!msg.options.useExistingStyles;
      const localStyles = useExistingStyles ? { paints: await figma.getLocalPaintStylesAsync(), texts: await figma.getLocalTextStylesAsync(), effects: await figma.getLocalEffectStylesAsync() } : null;
      const availableFonts = await figma.listAvailableFontsAsync(), availableFontMap = {}; for (const item of availableFonts) (availableFontMap[item.fontName.family] ||= []).push(item.fontName.style);
      const options = { mode: msg.options.mode || "pixel", autoLayout: msg.options.mode === "autolayout", flowFrames: new Set(), flowSpecs: new WeakMap(), flowWidths: new WeakMap(), flowChildren: new WeakMap(), gridFrames: new Set(), gridSpecs: new WeakMap(), sourceChildCounts: new WeakMap(), fontMap: msg.options.fontMap || {}, availableFontMap, textStyleMap: msg.options.textStyleMap || {}, useExistingStyles, localStyles, localVariables: [], totalNodes: countSourceNodes(msg.view.frame), cancelled:false, warnings:[], warningMap:new Map(), imageCache:new Map(), semanticNames:!!msg.options.semanticNames, iconVectors:!!msg.options.iconVectors, sourceMap:true, responsiveConstraints:true, organization:"single-page", stateVariants:false, rollbackNodes:[],rollbackPages:[],originalPage:figma.currentPage,accuracy:{count:0,positionError:0,sizeError:0}, sourceNodeMap:null, customFonts: msg.options.customFonts || {}, stats:{nodes:0,autoLayouts:0,grids:0,textStyles:0,gradients:0,masks:0,components:0,instances:0,imagesReused:0,iconVectors:0,iconWrappersRemoved:0,constraints:0,flattenedWrappers:0} };
      activeImport=options; const target=await updateSelectedImport(msg.payload, msg.filename, options, msg.view); activeImport=null; figma.currentPage.selection=[target]; figma.ui.postMessage({type:"done",report:{...options.stats,captures:1,mode:"Updated existing import",accuracy:accuracyReport(options),warnings:options.warnings.slice(0, 200),warningCount:options.warnings.length,version:BUILD_VERSION}}); return;
    }
    if (msg.type === "import-payload") {
      const useExistingStyles = !!msg.options.useExistingStyles, textStyleMap = msg.options.textStyleMap || {}, needsStyles = useExistingStyles || Object.keys(textStyleMap).length > 0;
      const localStyles = needsStyles ? { paints: useExistingStyles ? await figma.getLocalPaintStylesAsync() : [], texts: await figma.getLocalTextStylesAsync(), effects: useExistingStyles ? await figma.getLocalEffectStylesAsync() : [] } : null;
      const localVariables = useExistingStyles && localStyles && !localStyles.texts.length && figma.variables ? await figma.variables.getLocalVariablesAsync() : [];
      if (localStyles) for (const style of localStyles.texts) if (Object.values(textStyleMap).includes(style.id)) { try { await figma.loadFontAsync(style.fontName); } catch (_) {} }
      const availableFonts = await figma.listAvailableFontsAsync(), availableFontMap = {}; for (const item of availableFonts) (availableFontMap[item.fontName.family] ||= []).push(item.fontName.style);
      const totalNodes = msg.views.reduce((sum, view) => sum + countSourceNodes(view.frame), 0);
      const options = { mode: msg.options.mode || "pixel", autoLayout: msg.options.mode === "autolayout", flowFrames: new Set(), flowSpecs: new WeakMap(), flowWidths: new WeakMap(), flowChildren: new WeakMap(), gridFrames: new Set(), gridSpecs: new WeakMap(), sourceChildCounts: new WeakMap(), fontMap: msg.options.fontMap || {}, availableFontMap, textStyleMap, useExistingStyles, localStyles, localVariables, totalNodes, cancelled: false, warnings: [], warningMap: new Map(), imageCache: new Map(), semanticNames: !!msg.options.semanticNames, iconVectors: !!msg.options.iconVectors, sourceMap: true, responsiveConstraints:true, organization: msg.options.organization || "single-page", stateVariants: !!msg.options.stateVariants, rollbackNodes:[],rollbackPages:[],originalPage:figma.currentPage,accuracy:{count:0,positionError:0,sizeError:0}, sourceNodeMap: null, customFonts: msg.options.customFonts || {}, stats: { nodes: 0, autoLayouts: 0, grids: 0, textStyles: 0, gradients: 0, masks: 0, components: 0, instances: 0, imagesReused: 0, iconVectors: 0,iconWrappersRemoved:0,constraints:0,flattenedWrappers:0 } };
      activeImport = options;
      let offset = 0, roots = [];
      const originalPage = figma.currentPage; let lastImportPage = originalPage;
      for (let index = 0; index < msg.views.length; index++) {
        const view = msg.views[index];
        if (options.organization === "pages") {
          const page = figma.createPage(); page.name = `${String(msg.filename || "H2D").replace(/\.[^.]+$/, "")} / ${Math.round(view.captureWidth)}w ${view.theme}`; figma.currentPage = page; lastImportPage = page;
          options.rollbackPages.push(page);
        }
        figma.ui.postMessage({ type: "progress", current: options.stats.nodes, total: options.totalNodes, phase: `Capture ${index + 1}/${msg.views.length}` });
        const copy = { ...msg.payload, frame: view.frame, name: view.name };
        roots.push(await importPayload(copy, msg.filename, options, options.organization === "pages" ? 0 : offset, view));
        offset += px(view.artboardWidth, view.frame.width || 1440) + 320;
        await yieldImport(options, true);
      }
      options.renderCommitted = true; options.rollbackNodes = []; options.rollbackPages = [];
      if (options.organization === "pages") figma.currentPage = lastImportPage; else figma.currentPage = originalPage;
      if (msg.options.createComponents) {
        try { const generated = generateComponents(roots, msg.filename, true, msg.options.componentMode || "repeated", !!msg.options.stateVariants); options.stats.components = generated.components; options.stats.instances = generated.instances; options.stats.componentCandidates = generated.candidates; options.stats.componentGroups = generated.repeated; options.stats.componentFailures = generated.failures; options.stats.standaloneComponents = generated.standalone; options.stats.screenComponents = generated.screens; }
        catch (error) { warn(options,"COMPONENTS",`Design imported, but component generation was skipped safely: ${error&&error.message||error}`); }
      }
      activeImport = null;
      const selectableRoots = roots.filter(root => root && root.parent && root.parent.type === "PAGE" && root.parent === figma.currentPage); if (selectableRoots.length) { figma.currentPage.selection = selectableRoots; figma.viewport.scrollAndZoomIntoView(selectableRoots); } figma.notify(`${roots.length} H2D capture${roots.length > 1 ? "s" : ""} imported`); figma.ui.postMessage({ type: "done", report: { ...options.stats, captures: roots.length, mode: options.autoLayout ? "Auto Layout" : "Pixel Perfect", styles: useExistingStyles ? "On" : "Off", accuracy:accuracyReport(options), warnings: options.warnings.slice(0, 200), warningCount: options.warnings.length, version: BUILD_VERSION } }); return;
    }
    if (msg.type === "close") figma.closePlugin();
  }
  catch (err) { const failedImport=activeImport; activeImport = null; if(!failedImport||!failedImport.renderCommitted)rollbackImport(failedImport); figma.ui.postMessage({ type: err && err.cancelled ? "cancelled" : "error", message: String(err && (err.stack || err.message) || err) }); }
};