import JSZip from 'jszip';
import type { TimedSegment } from './tokenize';

function parseTime(t: string): number {
  // 00:01:02,345 | 00:01:02.345 | 01:02.345
  const m = t.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
  if (!m) return 0;
  const [, h, min, s, ms] = m;
  return (Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s)) + Number(ms.padEnd(3, '0').slice(0, 3)) / 1000;
}

/** Parse SRT or WebVTT subtitles into timed segments. */
export function parseSubtitles(src: string): TimedSegment[] {
  const blocks = src.replace(/\r/g, '').replace(/^WEBVTT[^\n]*\n/, '').split(/\n\s*\n/);
  const out: TimedSegment[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const text = lines
      .slice(ti + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .trim();
    if (!text) continue;
    out.push({ start: parseTime(a), end: parseTime(b.trim().split(/\s/)[0]), text });
  }
  return out;
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'BR', 'TR', 'SECTION', 'ARTICLE']);

/** Convert an HTML/XHTML document into plain paragraphs. */
export function htmlToText(doc: Document): string {
  doc.querySelectorAll('script,style,nav,header,footer,aside,noscript,svg,form,iframe').forEach((n) => n.remove());
  const root =
    doc.querySelector('article') ??
    doc.querySelector('main') ??
    doc.querySelector('[role=main]') ??
    doc.body ??
    doc.documentElement;
  const parts: string[] = [];
  let buf = '';
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      buf += node.textContent;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const block = BLOCK_TAGS.has(el.tagName.toUpperCase());
    if (block && buf.trim()) {
      parts.push(buf);
      buf = '';
    }
    el.childNodes.forEach(walk);
    if (block && buf.trim()) {
      parts.push(buf);
      buf = '';
    }
  };
  walk(root);
  if (buf.trim()) parts.push(buf);
  return parts
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function parseHtml(html: string, type: DOMParserSupportedType = 'text/html'): Document {
  return new DOMParser().parseFromString(html, type);
}

export interface ImportedPage {
  title: string;
  text: string;
}

/** Fetch a web article. Many sites block cross-origin reads; a CORS proxy can be configured. */
export async function importUrl(url: string, corsProxy: string): Promise<ImportedPage> {
  const target = corsProxy ? corsProxy.replace('{url}', encodeURIComponent(url)) : url;
  if (corsProxy && !corsProxy.includes('{url}')) throw new Error('CORS proxy must contain {url}');
  const res = await fetch(target);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const html = await res.text();
  const doc = parseHtml(html);
  const title =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ??
    doc.querySelector('h1')?.textContent ??
    doc.title ??
    url;
  return { title: title.trim(), text: htmlToText(doc) };
}

export interface EpubBook {
  title: string;
  author: string;
  chapters: ImportedPage[];
}

function dirname(p: string) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

/** Import an EPUB: each spine item with real content becomes a chapter. */
export async function importEpub(data: ArrayBuffer | Blob): Promise<EpubBook> {
  const zip = await JSZip.loadAsync(data);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('Not a valid EPUB (missing container.xml)');
  const opfPath = parseHtml(container, 'application/xml').querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('Not a valid EPUB (no rootfile)');
  const opfSrc = await zip.file(opfPath)?.async('string');
  if (!opfSrc) throw new Error('Missing OPF package');
  const opf = parseHtml(opfSrc, 'application/xml');
  const base = dirname(opfPath);
  const manifest = new Map<string, string>();
  opf.querySelectorAll('manifest > item').forEach((i) => manifest.set(i.getAttribute('id')!, i.getAttribute('href')!));
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || 'Untitled book';
  const author = opf.getElementsByTagName('dc:creator')[0]?.textContent?.trim() || '';
  const chapters: ImportedPage[] = [];
  for (const ref of Array.from(opf.querySelectorAll('spine > itemref'))) {
    const href = manifest.get(ref.getAttribute('idref') ?? '');
    if (!href) continue;
    const path = base + decodeURIComponent(href.split('#')[0]);
    const src = await zip.file(path)?.async('string');
    if (!src) continue;
    const doc = parseHtml(src, 'text/html');
    const heading = doc.querySelector('h1,h2,h3')?.textContent?.trim();
    const text = htmlToText(doc);
    if (text.split(/\s+/).length < 20) continue; // skip covers, title pages
    chapters.push({ title: heading || `Chapter ${chapters.length + 1}`, text });
  }
  return { title, author, chapters };
}

/** Split long text into lesson-sized chunks at paragraph boundaries. */
export function splitIntoLessons(text: string, maxWords: number): string[] {
  const paras = text.split(/\n\s*\n/);
  const out: string[] = [];
  let buf: string[] = [];
  let n = 0;
  for (const p of paras) {
    const w = p.split(/\s+/).filter(Boolean).length;
    if (n + w > maxWords && buf.length) {
      out.push(buf.join('\n\n'));
      buf = [];
      n = 0;
    }
    buf.push(p);
    n += w;
  }
  if (buf.length) out.push(buf.join('\n\n'));
  return out;
}
