import { posix } from 'node:path';
import { checkVendorInventory } from './vendor.mjs';

export const STRUCTURE_LIMITS = Object.freeze({
  sourceTarget: 400,
  sourceHard: 600,
  testHard: 700,
  mapLines: 80,
  mapChars: 6000,
  filesPerDirectory: 12,
  rootFiles: 24,
  childrenPerDirectory: 12,
});
const excluded = ['.git', 'node_modules', 'dist', '.arena', '.quality', 'artifacts', 'engine/target'];
const sections = ['Назначение', 'Границы', 'Зависимости', 'Карта'];
const sourceFile = /\.(?:[cm]?js|css|rs)$/i;
const testFile = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?js$/i;
const vendorRoot = 'reference/linux';

export function isStructureExcluded(path) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  return excluded.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function vendorFile(path) {
  return path === vendorRoot || path.startsWith(`${vendorRoot}/`);
}

function normalizeFiles(input) {
  if (!(input instanceof Map)) throw new TypeError('analyzeStructure requires Map<relative path, text>.');
  const files = new Map();
  for (const [path, text] of input) {
    if (typeof path !== 'string' || typeof text !== 'string')
      throw new TypeError('Inventory paths and contents must be strings.');
    const name = posix.normalize(path.replaceAll('\\', '/')).replace(/^\.\//, '');
    if (!name || name === '.' || /^(?:\/|[a-z]:|\.\.(?:\/|$))/i.test(name) || name.includes('\0'))
      throw new TypeError('Inventory paths must stay inside the repository.');
    if (files.has(name)) throw new TypeError(`Duplicate normalized inventory path: ${name}`);
    if (!isStructureExcluded(name)) files.set(name, text);
  }
  return files;
}

function directoryIndex(files) {
  const directories = new Map();
  const get = (path) => {
    if (!directories.has(path)) directories.set(path, { files: new Set(), children: new Set() });
    return directories.get(path);
  };
  get('');
  for (const file of files.keys()) {
    const parts = (vendorFile(file) ? vendorRoot : file).split('/');
    let directory = '';
    for (const part of parts.slice(0, -1)) {
      get(directory).children.add(part);
      directory = directory ? `${directory}/${part}` : part;
      get(directory);
    }
    if (vendorFile(file)) get(directory).children.add(parts.at(-1));
    else get(directory).files.add(parts.at(-1));
  }
  return directories;
}

function linesOf(text) {
  return text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
}

function checkSize(file, text, add) {
  if (vendorFile(file) || !sourceFile.test(file)) return;
  const lines = linesOf(text).length;
  const limit = testFile.test(file) ? STRUCTURE_LIMITS.testHard : STRUCTURE_LIMITS.sourceHard;
  if (lines > limit)
    add(
      file,
      1,
      'ERROR',
      'file-size',
      `${lines} lines exceed the hard limit ${limit}.`,
      'Split responsibilities into cohesive modules; keep behavior covered by tests.',
    );
  else if (!testFile.test(file) && lines > STRUCTURE_LIMITS.sourceTarget)
    add(
      file,
      1,
      'REVIEW_REQUIRED',
      'file-size',
      `${lines} lines exceed the source target ${STRUCTURE_LIMITS.sourceTarget}.`,
      'Review whether this file still has one cohesive responsibility; do not split arbitrarily.',
    );
}

function visibleLines(text) {
  const result = [];
  let fence = null;
  let comment = false;
  for (const [index, raw] of linesOf(text).entries()) {
    if (fence) {
      const close = /^ {0,3}(`+|~+)\s*$/.exec(raw)?.[1];
      if (close?.[0] === fence[0] && close.length >= fence.length) fence = null;
      continue;
    }
    let line = '',
      rest = raw;
    while (rest.length) {
      const marker = rest.indexOf(comment ? '-->' : '<!--');
      if (marker < 0) {
        if (!comment) line += rest;
        break;
      }
      if (!comment) line += rest.slice(0, marker);
      rest = rest.slice(marker + (comment ? 3 : 4));
      comment = !comment;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (opening) {
      fence = opening;
      continue;
    }
    if (!/^(?: {4}|\t)/.test(line)) result.push({ line: index + 1, text: line });
  }
  return result;
}

function mapSections(text, map, add) {
  const result = new Map();
  let current = null;
  for (const row of visibleLines(text)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(row.text.trim())?.[1];
    if (heading) {
      current = sections.find((name) => name.toLowerCase() === heading.toLowerCase()) ?? null;
      if (current !== null) {
        if (result.has(current))
          add(
            map,
            row.line,
            'ERROR',
            'map-section',
            `Section ${current} is repeated.`,
            'Keep one explicit section per role.',
          );
        else result.set(current, []);
      }
      continue;
    }
    if (current !== null) result.get(current).push(row);
  }
  for (const name of sections) {
    if (!result.has(name) || !result.get(name).some((row) => row.text.trim()))
      add(
        map,
        1,
        'ERROR',
        'map-section',
        `Section ${name} is missing or empty.`,
        `Add a concise ${name} section.`,
      );
  }
  return result;
}

function tableCells(text) {
  const row = text.trim();
  return row.startsWith('|') && row.endsWith('|')
    ? row
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim())
    : null;
}

function targetOf(cell) {
  const link = /^\[[^\]]+\]\((?:<([^>]+)>|([^()]+))\)$/.exec(cell);
  if (!link) return null;
  let path;
  try {
    path = decodeURIComponent(link[1] ?? link[2]);
  } catch {
    return null;
  }
  if (/^(?:[/\\]|[a-z][a-z\d+.-]*:)/i.test(path) || /[\\\0?#]/.test(path) || path.split('/').includes('..'))
    return null;
  const normalized = posix.normalize(path).replace(/^\.\//, '');
  return normalized === '.' ? null : normalized;
}

function expectedTargets(directory, contents) {
  const targets = new Set([...contents.files].filter((file) => file !== 'AGENTS.md'));
  for (const child of contents.children) {
    const path = directory ? `${directory}/${child}` : child;
    targets.add(path === vendorRoot ? `${child}/` : `${child}/AGENTS.md`);
  }
  return targets;
}

function checkMapRows(directory, map, rows, expected, files, add) {
  let header = false;
  const found = new Set();
  for (const row of rows) {
    const cells = tableCells(row.text);
    if (cells === null) continue;
    if (cells.length === 2 && cells[0] === 'Путь' && cells[1] === 'Ответственность') {
      if (header)
        add(
          map,
          row.line,
          'ERROR',
          'map-table',
          'The responsibility table header is repeated.',
          'Keep one ownership table.',
        );
      header = true;
      continue;
    }
    if (cells.length === 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (!header || cells.length !== 2) {
      add(
        map,
        row.line,
        'ERROR',
        'map-table',
        'Malformed ownership table row.',
        'Use | Путь | Ответственность | and two cells per row.',
      );
      continue;
    }
    const target = targetOf(cells[0]);
    if (target === null) {
      add(
        map,
        row.line,
        'ERROR',
        'map-link',
        'Map entry must be one safe relative Markdown link.',
        'Link a direct file or child/AGENTS.md without escaping the owning directory.',
      );
      continue;
    }
    if (!cells[1].replace(/[*_`\s]/g, ''))
      add(
        map,
        row.line,
        'ERROR',
        'map-responsibility',
        `Responsibility for ${target} is empty.`,
        'State the concrete responsibility of this file or child component.',
      );
    if (found.has(target))
      add(
        map,
        row.line,
        'ERROR',
        'map-duplicate',
        `Map entry ${target} is repeated.`,
        'Keep exactly one responsibility row per direct item.',
      );
    found.add(target);
    const path = directory ? `${directory}/${target}` : target;
    const exists =
      path === `${vendorRoot}/` ? [...files.keys()].some((file) => file.startsWith(path)) : files.has(path);
    if (!exists || !expected.has(target))
      add(
        map,
        row.line,
        'ERROR',
        'map-stale',
        `Map entry ${target} does not identify an existing direct item.`,
        'Remove stale rows or link the actual direct file/child map.',
      );
  }
  if (!header)
    add(
      map,
      1,
      'ERROR',
      'map-table',
      'The ownership table header is missing.',
      'Add | Путь | Ответственность | in the Карта section.',
    );
  for (const target of expected) {
    if (!found.has(target))
      add(
        map,
        1,
        'ERROR',
        'map-unowned',
        `Direct item ${target} has no responsibility row.`,
        'Add its relative link and concrete responsibility to the owning map.',
      );
  }
}

function checkDirectory(directory, contents, files, add) {
  const map = directory ? `${directory}/AGENTS.md` : 'AGENTS.md';
  const fileCount = [...contents.files].filter((file) => file !== 'AGENTS.md').length;
  const limit = directory ? STRUCTURE_LIMITS.filesPerDirectory : STRUCTURE_LIMITS.rootFiles;
  if (fileCount > limit || contents.children.size > STRUCTURE_LIMITS.childrenPerDirectory)
    add(
      map,
      1,
      'ERROR',
      'directory-clutter',
      `${fileCount} direct files / ${contents.children.size} child directories exceed limits ${limit} / ${STRUCTURE_LIMITS.childrenPerDirectory}.`,
      'Group cohesive responsibilities into child components; update their architecture maps.',
    );
  const text = files.get(map);
  if (text === undefined) {
    add(
      map,
      1,
      'ERROR',
      'map-missing',
      `First-party directory ${directory || '.'} has no AGENTS.md.`,
      'Add the concise local purpose, boundaries, dependencies and responsibility map.',
    );
    return;
  }
  if (linesOf(text).length > STRUCTURE_LIMITS.mapLines || text.length > STRUCTURE_LIMITS.mapChars)
    add(
      map,
      1,
      'ERROR',
      'map-budget',
      `Map exceeds ${STRUCTURE_LIMITS.mapLines} lines or ${STRUCTURE_LIMITS.mapChars} characters.`,
      'Keep local context concise; link deeper responsibilities instead of repeating them.',
    );
  const parsed = mapSections(text, map, add);
  checkMapRows(directory, map, parsed.get('Карта') ?? [], expectedTargets(directory, contents), files, add);
  if (
    directory === 'reference' &&
    contents.children.has('linux') &&
    (!files.has('reference/manifest.json') ||
      !/(?:upstream|pinned|закрепл|первичн)/i.test(text) ||
      !/manifest\.json/.test(text))
  )
    add(
      map,
      1,
      'ERROR',
      'vendor-boundary',
      'The pinned Linux boundary needs its manifest and preservation rationale.',
      'Document linux/ as delegated upstream bytes and explain reference/manifest.json without adding maps inside it.',
    );
}

/** Validate the supplied complete inventory; never read disk or mutate files. */
export function analyzeStructure(inputFiles) {
  const files = normalizeFiles(inputFiles);
  const findings = [];
  const add = (file, line, severity, rule, reason, fix) =>
    findings.push({ file, line, severity, rule, reason, fix });
  checkVendorInventory(files, add);
  for (const [file, text] of files) checkSize(file, text, add);
  for (const [directory, contents] of directoryIndex(files)) checkDirectory(directory, contents, files, add);
  return findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule) ||
      a.reason.localeCompare(b.reason),
  );
}
