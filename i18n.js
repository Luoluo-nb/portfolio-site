import { translations, chineseAliases } from './translations.js';

const storageKey = 'portfolio-language';
const normalize = text => text.trim().replace(/\s+/g, ' ');
const dictionary = new Map(Object.entries(translations).map(([zh, en]) => [normalize(zh), en]));
const aliases = new Map(Object.entries(chineseAliases).map(([source, zh]) => [normalize(source), zh]));
const textRecords = new WeakMap();
const attributeRecords = new WeakMap();
const translatedAttributes = ['aria-label', 'title', 'alt', 'placeholder'];
const excluded = 'script,style,code,pre,textarea,[data-no-translate],[translate="no"],[contenteditable="true"]';
let language = 'zh';
try { language = localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh'; } catch { /* Storage is optional. */ }

function chineseSource(text) {
  const key = normalize(text);
  if (aliases.has(key)) return aliases.get(key);
  return text.replace(/\bSHOWREEL\b/g, '作品合集').replace(/\bVEHICLE\b/g, '车辆').replace(/ \/ VIDEO\b/g, ' / 视频');
}

function translateCore(source) {
  const key = normalize(source);
  if (dictionary.has(key)) return dictionary.get(key);
  // Composed UI messages retain the same source data as ordinary project text.
  const rules = [
    [/^(.*?) · 张致远 — 美术 \/ 技术美术$/, (_, page) => `${translateCore(page)} · Zhang Zhiyuan — Artist / Technical Artist`],
    [/^张致远 — 美术 \/ 技术美术$/, () => 'Zhang Zhiyuan — Artist / Technical Artist'],
    [/^(.*?) · 张致远作品集$/, (_, title) => `${translateCore(title)} · Zhang Zhiyuan’s Portfolio`],
    [/^(.*?) · 张致远$/, (_, title) => `${translateCore(title)} · Zhang Zhiyuan`],
    [/^已切换到(.+)$/, (_, view) => `Switched to ${translateCore(view)}`],
    [/^已选择[：:]\s*(.+)$/, (_, title) => `Selected: ${translateCore(title)}`],
    [/^正在播放[：:]\s*(.+)$/, (_, title) => `Playing: ${translateCore(title)}`],
    [/^播放速度[：:]\s*([\d.]+)倍$/, (_, speed) => `Playback speed: ${speed}×`],
    [/^播放 (.+)$/, (_, title) => `Play ${translateCore(title)}`],
    [/^查看 (.+) 详情$/, (_, title) => `View ${translateCore(title)} details`],
    [/^(.+) — Bilibili 播放器$/, (_, title) => `${translateCore(title)} — Bilibili player`],
    [/^(.+)，在新标签页查看大图$/, (_, caption) => `${translateCore(caption)}; view full image in a new tab`],
    [/^(\d{2}) \/ (.+)$/, (_, index, title) => `${index} / ${translateCore(title)}`],
    [/^(\d+:\d+) \/ 视频$/, (_, duration) => `${duration} / VIDEO`],
    [/^(Unity|UNITY|Unreal Engine|UNREAL ENGINE|作品合集) ([·/]) (.+)$/, (_, engine, separator, rest) => `${translateCore(engine)} ${separator} ${translateCore(rest)}`],
    [/^(.*\S)\s+([↗↑↓])$/, (_, label, arrow) => `${translateCore(label)} ${arrow}`],
    [/^(←)\s*(.+)$/, (_, arrow, label) => `${arrow} ${translateCore(label)}`],
  ];
  for (const [pattern, replacement] of rules) if (pattern.test(key)) return key.replace(pattern, replacement);
  if (key.includes('\n')) return source.split('\n').map(translateCore).join('\n');
  return source;
}

export function translate(text, target = language) {
  if (typeof text !== 'string' || !text.trim()) return text;
  const leading = text.match(/^\s*/)[0];
  const trailing = text.match(/\s*$/)[0];
  const source = chineseSource(text.trim());
  return leading + (target === 'en' ? translateCore(source) : source) + trailing;
}

function skip(node) {
  return (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(excluded);
}

function applyText(node) {
  if (skip(node) || !node.nodeValue.trim()) return;
  let record = textRecords.get(node);
  // Application renders replace the source; our own observer notifications do not.
  if (!record || node.nodeValue !== record.rendered) record = { source: chineseSource(node.nodeValue), rendered: node.nodeValue };
  let rendered = translate(record.source);
  // These headings split a Chinese word across spans for the accent color.
  // Translate the fragments together without replacing their DOM structure.
  if (language === 'en') {
    const heading = node.parentElement?.closest('#works-title,#about-title,#contact-title');
    const fragments = {
      'works-title': { '作品': 'Port', '集': 'folio' },
      'about-title': { '关于': 'About', '我': ' Me' },
      'contact-title': { '保持': 'Get in ', '联系': 'Touch' },
    };
    const fragment = fragments[heading?.id]?.[record.source.trim()];
    if (fragment !== undefined) rendered = fragment;
  }
  record.rendered = rendered;
  textRecords.set(node, record);
  if (node.nodeValue !== rendered) node.nodeValue = rendered;
}

function applyAttributes(element) {
  if (skip(element)) return;
  let records = attributeRecords.get(element);
  if (!records) { records = new Map(); attributeRecords.set(element, records); }
  const names = element.matches('meta[name="description"],meta[property="og:title"],meta[property="og:description"]')
    ? [...translatedAttributes, 'content'] : translatedAttributes;
  for (const name of names) {
    if (!element.hasAttribute(name)) continue;
    const value = element.getAttribute(name);
    let record = records.get(name);
    if (!record || value !== record.rendered) record = { source: chineseSource(value), rendered: value };
    const rendered = translate(record.source);
    record.rendered = rendered;
    records.set(name, record);
    if (value !== rendered) element.setAttribute(name, rendered);
  }
}

function translateTree(root) {
  if (!root || skip(root)) return;
  if (root.nodeType === Node.TEXT_NODE) { applyText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) applyAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) { return skip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
  });
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) applyText(node);
    else applyAttributes(node);
  }
}

let switcher;
function updateSwitcher() {
  if (!switcher) return;
  switcher.setAttribute('aria-label', language === 'en' ? 'Website language' : '网站语言');
  for (const button of switcher.querySelectorAll('button')) {
    const active = button.dataset.language === language;
    button.setAttribute('aria-pressed', String(active));
    button.title = button.dataset.language === 'zh' ? '切换到中文' : 'Switch to English';
  }
}

export function setLanguage(next, persist = true) {
  language = next === 'en' ? 'en' : 'zh';
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.language = language;
  if (persist) try { localStorage.setItem(storageKey, language); } catch { /* Optional preference. */ }
  translateTree(document.documentElement);
  updateSwitcher();
  window.dispatchEvent(new CustomEvent('portfolio:languagechange', { detail: { language } }));
}

function mount() {
  const header = document.querySelector('.header');
  if (header && !header.querySelector('.language-switch')) {
    let tools = header.querySelector('.header-tools');
    if (!tools) { tools = document.createElement('div'); tools.className = 'header-tools'; header.append(tools); }
    switcher = document.createElement('div');
    switcher.className = 'language-switch';
    switcher.dataset.noTranslate = '';
    switcher.setAttribute('role', 'group');
    for (const [value, label] of [['zh', '中文'], ['en', 'English']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.language = value;
      button.lang = value === 'zh' ? 'zh-CN' : 'en';
      button.textContent = label;
      button.addEventListener('click', () => setLanguage(value));
      switcher.append(button);
    }
    tools.append(switcher);
  } else switcher = header?.querySelector('.language-switch');
  setLanguage(language, false);
  const observer = new MutationObserver(records => {
    const roots = new Set();
    for (const record of records) {
      if (record.type === 'characterData') roots.add(record.target);
      else if (record.type === 'attributes') applyAttributes(record.target);
      else for (const node of record.addedNodes) roots.add(node);
    }
    for (const root of roots) if (root.isConnected) translateTree(root);
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: [...translatedAttributes, 'content'],
  });
  window.addEventListener('storage', event => {
    if (event.key === storageKey) setLanguage(event.newValue, false);
  });
}

window.PortfolioI18n = {
  translate, setLanguage,
  get language() { return language; },
  refresh(root = document.documentElement) { translateTree(root); },
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
