#!/usr/bin/env node
'use strict';

const { existsSync, mkdirSync } = require('fs');
const { join } = require('path');

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  console.error('web-search-google-lite failed: puppeteer-core is not installed.');
  process.exit(1);
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: search.js --keyword "query" [--max-results 10]',
      '',
      'Options:',
      '  --keyword, -k      Search keyword (required)',
      '  --max-results, -n  Maximum number of results, default 10, max 20',
      '  --help, -h         Show this help message',
      '',
      'Example:',
      '  node scripts/search.js --keyword "TypeScript tutorial" --max-results 5',
      '',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let keyword = '';
  let maxResults = 10;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--keyword' || arg === '-k') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --keyword');
      }
      keyword = value.trim();
      i += 1;
      continue;
    }

    if (arg.startsWith('--keyword=')) {
      keyword = arg.slice('--keyword='.length).trim();
      continue;
    }

    if (arg === '--max-results' || arg === '-n') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --max-results');
      }
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        maxResults = parsed;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith('--max-results=')) {
      const parsed = Number.parseInt(arg.slice('--max-results='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        maxResults = parsed;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!keyword) {
    throw new Error('Missing required argument: --keyword');
  }

  return {
    query: keyword,
    maxResults: Math.min(maxResults, 20),
  };
}

function getPersistentUserDataDir() {
  const dir = join(__dirname, '..', '.runtime', 'chrome-profile');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getChromePath() {
  const platform = process.platform;
  const paths = [];

  if (platform === 'darwin') {
    paths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    );
  } else if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    paths.push(
      join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe')
    );
  } else {
    paths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/snap/bin/chromium'
    );
  }

  for (const candidate of paths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('No Chromium-based browser found (Chrome/Edge/Chromium).');
}

function resolveHeadless() {
  const override = (process.env.WEB_SEARCH_HEADLESS || '').trim().toLowerCase();
  if (override === '1' || override === 'true' || override === 'yes') return true;
  if (override === '0' || override === 'false' || override === 'no') return false;
  return false;
}

function normalizeText(input, maxChars) {
  if (!input) return '';
  const compact = input
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars)}...`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMarkdown(query, durationMs, results, crawledCount) {
  const lines = [];
  lines.push(`# Search Results: ${query}`);
  lines.push('');
  lines.push(`**Query:** ${query}  `);
  lines.push('**Engine:** google  ');
  lines.push(`**URLs Crawled:** ${crawledCount}  `);
  lines.push(`**Results:** ${results.length}  `);
  lines.push(`**Time:** ${durationMs}ms  `);
  lines.push('');
  lines.push('---');
  lines.push('');

  results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${result.title || 'Untitled'}`);
    lines.push('');
    lines.push(`**URL:** [${result.url}](${result.url})`);
    lines.push('');
    lines.push('**Content:**');
    lines.push('');
    lines.push(result.content || '(No content extracted)');
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

async function mapWithConcurrency(items, limit, mapper) {
  const size = Math.max(1, Math.min(limit, items.length || 1));
  const output = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: size }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      output[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return output;
}

async function collectGoogleCandidates(page, query, maxResults) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
  const resultSelector = 'div#search a h3, div#search div.g';

  const openSearchPage = async () => {
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
  };

  const waitForResultSelector = async () => {
    try {
      await page.waitForSelector(resultSelector, { timeout: 12000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('detached Frame')
        || message.includes('Execution context was destroyed')
        || message.includes('Target closed')
      ) {
        await openSearchPage();
        await page.waitForSelector(resultSelector, { timeout: 12000 });
        return;
      }
      throw error;
    }
  };

  await openSearchPage();

  if (page.url().includes('/sorry/')) {
    process.stderr.write('Google returned a verification page (/sorry).\n');
    process.stderr.write('Please complete verification in the opened browser (up to 60 seconds)...\n');

    const deadline = Date.now() + 60_000;
    let verified = false;
    while (Date.now() < deadline) {
      try {
        if (!page.url().includes('/sorry/')) {
          verified = true;
          break;
        }
      } catch {
        // Frame/page can briefly detach during verification redirects; keep waiting.
      }
      await sleep(1000);
    }

    if (!verified) {
      let stillBlocked = true;
      try {
        stillBlocked = page.url().includes('/sorry/');
      } catch {
        stillBlocked = true;
      }
      if (stillBlocked) {
        throw new Error('Google blocked this request with a verification page (/sorry) after waiting up to 60 seconds.');
      }
    }

    // Verification flow often lands on consent/home pages first; reload target search to stabilize parsing.
    await openSearchPage();
    if (page.url().includes('/sorry/')) {
      throw new Error('Google blocked this request with a verification page (/sorry) after waiting up to 60 seconds.');
    }
  }

  await waitForResultSelector();

  return page.evaluate((max) => {
    const parseGoogleUrl = (rawUrl) => {
      if (!rawUrl) return '';
      try {
        const parsed = new URL(rawUrl, window.location.origin);
        if (parsed.hostname.includes('google.') && parsed.pathname === '/url') {
          return parsed.searchParams.get('q') || parsed.searchParams.get('url') || '';
        }
        return parsed.href;
      } catch {
        return '';
      }
    };

    const isBadUrl = (url) => {
      if (!url) return true;
      try {
        const parsed = new URL(url);
        if (['http:', 'https:'].includes(parsed.protocol) === false) return true;
        if (parsed.hostname.includes('google.') && parsed.pathname === '/search') return true;
        if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) return true;
        return false;
      } catch {
        return true;
      }
    };

    const seen = new Set();
    const candidates = [];
    const blocks = Array.from(document.querySelectorAll('div#search div.g, div#search [data-sokoban-container]'));

    const push = (title, rawUrl) => {
      const url = parseGoogleUrl(rawUrl);
      const trimmedTitle = (title || '').trim();
      if (!trimmedTitle || isBadUrl(url) || seen.has(url)) return;
      seen.add(url);
      candidates.push({ title: trimmedTitle, url });
    };

    for (const block of blocks) {
      if (candidates.length >= max) break;
      const titleNode = block.querySelector('h3');
      const anchorNode = titleNode?.closest('a') || block.querySelector('a[href]');
      push(titleNode?.textContent || anchorNode?.textContent || '', anchorNode?.href || '');
    }

    if (candidates.length < max) {
      const titleNodes = Array.from(document.querySelectorAll('div#search a h3'));
      for (const titleNode of titleNodes) {
        if (candidates.length >= max) break;
        const anchorNode = titleNode.closest('a');
        push(titleNode.textContent || '', anchorNode?.href || '');
      }
    }

    return candidates.slice(0, max);
  }, maxResults);
}

async function extractPageContent(browser, candidate) {
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  );

  try {
    await page.goto(candidate.url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    await page.waitForSelector('body', { timeout: 8000 });

    const extracted = await page.evaluate(() => {
      const clean = (value) => (value || '')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const getText = (element) => clean(element?.innerText || '');

      const candidates = [
        'article',
        'main',
        '[role="main"]',
        '.post-content',
        '.entry-content',
        '.article-content',
        '#content',
      ];

      let best = '';
      for (const selector of candidates) {
        const node = document.querySelector(selector);
        const text = getText(node);
        if (text.length > best.length) best = text;
      }

      if (best.length < 300) {
        const paragraphs = Array.from(document.querySelectorAll('p'))
          .map((p) => getText(p))
          .filter((text) => text.length > 40);
        const joined = clean(paragraphs.slice(0, 30).join('\n\n'));
        if (joined.length > best.length) best = joined;
      }

      if (best.length < 200) {
        best = getText(document.body);
      }

      const metaDescription = clean(
        document.querySelector('meta[name="description"]')?.getAttribute('content')
        || document.querySelector('meta[property="og:description"]')?.getAttribute('content')
        || ''
      );

      return {
        title: clean(document.title || ''),
        content: best,
        metaDescription,
      };
    });

    const content = normalizeText(extracted.content || extracted.metaDescription, 1800);
    return {
      title: extracted.title || candidate.title,
      url: candidate.url,
      content,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      title: candidate.title,
      url: candidate.url,
      content: `Failed to fetch content: ${message}`,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function run() {
  const { query, maxResults } = parseArgs(process.argv);
  const chromePath = getChromePath();
  const headless = resolveHeadless();
  const startTime = Date.now();
  const userDataDir = getPersistentUserDataDir();

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless,
      userDataDir,
      ignoreDefaultArgs: ['--disable-sync'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });

    const googlePage = await browser.newPage();
    const candidates = await collectGoogleCandidates(googlePage, query, maxResults);
    await googlePage.close().catch(() => {});

    process.stderr.write(`Searching Google for "${query}"...\n`);
    process.stderr.write(`Collected ${candidates.length} candidate URLs.\n`);

    const results = await mapWithConcurrency(candidates, 3, async (candidate, index) => {
      process.stderr.write(`Fetching (${index + 1}/${candidates.length}): ${candidate.url}\n`);
      return extractPageContent(browser, candidate);
    });

    const duration = Date.now() - startTime;
    process.stderr.write(`Finished ${results.length} pages in ${duration}ms.\n`);
    process.stdout.write(formatMarkdown(query, duration, results, candidates.length));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`web-search-google-lite failed: ${message}\n`);
  process.exit(1);
});
