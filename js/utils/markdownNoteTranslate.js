/**
 * Markdown Note Translation Helper (Zero Dependencies)
 * - HTML -> Placeholder -> Translate backfill -> HTML
 * - Protect code blocks/inline code and URL attributes of links/images, only translate visible text and optional img.alt
 */

// --- Configuration items---
const DEFAULT_OPTIONS = {
  translateImageAlt: true, // Whether to translate <img alt>
  keepSurroundingPunctuation: false // Whether to keep surrounding punctuation untranslated
};

// Placeholder generation
const PH_PREFIX = "⟪T";
const PH_SUFFIX = "⟫";

// Determine if inside code context
function isInCodeContext(node) {
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName?.toLowerCase();
      if (tag === 'code' || tag === 'pre') return true;
    }
    node = node.parentNode;
  }
  return false;
}

// Determine if attribute is URL/non-translatable attribute
function isNonTranslatableAttr(name) {
  if (!name) return true;
  const n = name.toLowerCase();
  return n === 'href' || n === 'src' || n.startsWith('data-') || n === 'title';
}

// Split leading and trailing whitespace and punctuation
function splitLeadingTrailing(text, keepPunct) {
  if (!text) return { lead: '', core: '', trail: '' };
  let leadWS = text.match(/^\s+/)?.[0] || '';
  let trailWS = text.match(/\s+$/)?.[0] || '';
  let core = text.slice(leadWS.length, text.length - trailWS.length);

  if (keepPunct && core) {
    const punctSet = new Set([',', '，', '.', '。', '!', '！', '?', '？', ':', '：', ';', '；']);
    let left = 0;
    while (left < core.length && punctSet.has(core[left])) left++;
    let right = core.length - 1;
    while (right >= left && punctSet.has(core[right])) right--;
    const leftP = core.slice(0, left);
    const mid = core.slice(left, right + 1);
    const rightP = core.slice(right + 1);
    return { lead: leadWS + leftP, core: mid, trail: rightP + trailWS };
  }

  return { lead: leadWS, core, trail: trailWS };
}

// Traverse text nodes and protect placeholders
function protectAndExtract(html, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  const texts = [];
  const placeholders = [];
  let index = 0;

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      // Skip pure whitespace
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      // Skip code context
      if (isInCodeContext(node)) return NodeFilter.FILTER_REJECT;
      // Attribute text does not appear in TreeWalker, only filter visible text nodes here
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodeRecords = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    // If inside a link or image etc., only translate visible text
    const parentEl = node.parentElement;
    if (parentEl) {
      const tag = parentEl.tagName?.toLowerCase();
      if (tag === 'a') {
        // Only translate node text, skip attributes
      } else if (tag === 'img') {
        // Text nodes generally do not appear under <img>, skip here
      }
    }

    const { lead, core, trail } = splitLeadingTrailing(node.nodeValue, opts.keepSurroundingPunctuation);
    if (!core) continue; // All whitespace or punctuation with keepPunct set

    const ph = `${PH_PREFIX}${index}${PH_SUFFIX}`;
    texts.push(core);
    placeholders.push(ph);
    nodeRecords.push({ node, lead, trail, ph });
    index++;
  }

  // Replace text nodes with placeholder structure: lead + PH + trail
  for (const rec of nodeRecords) {
    rec.node.nodeValue = `${rec.lead}${rec.ph}${rec.trail}`;
  }

  // Optional: Process <img alt>
  const imgList = Array.from(body.querySelectorAll('img[alt]'));
  const imgAltRecords = [];
  if (opts.translateImageAlt && imgList.length) {
    for (const img of imgList) {
      const alt = img.getAttribute('alt');
      if (alt && alt.trim() && !isInCodeContext(img)) {
        const { lead, core, trail } = splitLeadingTrailing(alt, opts.keepSurroundingPunctuation);
        if (!core) continue;
        const ph = `${PH_PREFIX}${index}${PH_SUFFIX}`;
        texts.push(core);
        placeholders.push(ph);
        imgAltRecords.push({ el: img, lead, trail, ph });
        index++;
      }
    }
  }

  for (const rec of imgAltRecords) {
    rec.el.setAttribute('alt', `${rec.lead}${rec.ph}${rec.trail}`);
  }

  // Return placeholder HTML and text arrays
  return {
    placeholderHTML: body.innerHTML,
    texts,
    placeholders
  };
}

// Backfill translations
function restoreWithTranslations(placeholderHTML, placeholders, translations) {
  let html = placeholderHTML;
  for (let i = 0; i < placeholders.length; i++) {
    const ph = placeholders[i];
    const tr = translations[i] ?? '';
    // Replace only once to maintain order
    html = html.replace(ph, tr);
  }
  return html;
}

export const MarkdownNoteTranslate = {
  protectAndExtract,
  restoreWithTranslations,
  constants: { PH_PREFIX, PH_SUFFIX },
};