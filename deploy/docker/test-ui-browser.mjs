/**
 * Browser checks for the PCP web UI (run by deploy/docker/test-ui-browser.sh).
 *
 * Covers, at desktop (1280x800) and phone (390x844) widths in light and dark
 * themes:
 *   - the top navigation for signed-in admins and members (Sessions and
 *     Projects entries, admin-only Tokens/Settings, a working phone menu);
 *   - every modal dialog (token manager, per-session tokens, token display):
 *     fully inside the viewport, labelled role="dialog", focus moves in and
 *     stays trapped, every control is hit-testable, Esc and the close button
 *     both close it and focus returns to the opener;
 *   - the signed-in landing page and member session visibility;
 *   - the projects list and detail pages (when the server has them).
 *
 * Prints one JSON line per check and exits 1 if any check failed.
 */
import { createRequire } from 'node:module';

const require = createRequire(`${process.env.NODE_PATH || '/pw/node_modules'}/`);
const { chromium } = require('playwright-core');

const BASE = process.env.PCP_UI_BASE || 'http://localhost:3000';
const OUT = '/out';
const results = [];
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };

function record(name, ok, detail = {}) {
  results.push({ name, ok, ...detail });
  console.log(JSON.stringify({ check: name, ok, ...detail }));
}

async function newContext(browser, who, viewport, theme) {
  const context = await browser.newContext({ viewport, colorScheme: theme });
  await context.addInitScript((t) => localStorage.setItem('pcp_theme', t), theme);
  const session = process.env[`PCP_UI_${who.toUpperCase()}_SESSION`];
  const csrf = process.env[`PCP_UI_${who.toUpperCase()}_CSRF`];
  await context.addCookies([
    { name: '__Host-pcp_session', value: session, url: BASE.replace(/^http:/, 'https:'), secure: true, httpOnly: true, sameSite: 'Lax' },
    { name: '__Host-pcp_csrf', value: csrf, url: BASE.replace(/^http:/, 'https:'), secure: true, sameSite: 'Lax' },
  ]);
  return context;
}

/** Find a top-nav entry; on a phone it may sit behind the menu button. */
async function navEntry(page, name, kind = 'link') {
  const direct = page.getByRole('navigation').getByRole(kind, { name, exact: true });
  for (const candidate of await direct.all()) if (await candidate.isVisible()) return candidate;
  const menu = page.getByRole('navigation').getByRole('button', { name: /menu/i }).first();
  if (await menu.isVisible().catch(() => false)) {
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
    for (const candidate of await page.getByRole(kind, { name, exact: true }).all()) if (await candidate.isVisible()) return candidate;
  }
  return null;
}

async function closeMenu(page) {
  const menu = page.getByRole('navigation').getByRole('button', { name: /menu/i }).first();
  if ((await menu.isVisible().catch(() => false)) && (await menu.getAttribute('aria-expanded')) === 'true') await menu.click();
}

/** Locate the open dialog: role=dialog, else the overlay panel around `heading`. */
async function findDialog(page, heading) {
  const dialog = page.getByRole('dialog');
  // Dialogs mount in a portal one tick after the click.
  await dialog.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if (await dialog.first().isVisible().catch(() => false)) return { panel: dialog.first(), semantic: true };
  const h = page.getByText(heading, { exact: false }).first();
  if (!(await h.count())) return null;
  return { panel: h.locator('xpath=ancestor::div[contains(@class,"shadow-xl")][1]'), semantic: false };
}

/** Geometry, hit-testing, focus trap and Esc for one open dialog. */
async function checkDialog(page, label, heading, opener, prefix) {
  const found = await findDialog(page, heading);
  if (!found) return record(`${prefix} ${label}: opens`, false, { reason: 'dialog not found' });
  const { panel, semantic } = found;
  record(`${prefix} ${label}: role=dialog + aria-modal`, semantic && (await panel.getAttribute('aria-modal')) === 'true');
  const vp = page.viewportSize();
  const box = await panel.boundingBox();
  const inside = Boolean(box) && box.y >= 0 && box.x >= 0 && box.y + box.height <= vp.height + 1 && box.x + box.width <= vp.width + 1;
  record(`${prefix} ${label}: panel inside viewport`, inside, { box, viewport: vp });

  // Every visible control must be the element actually under its own center.
  const blocked = await panel.evaluate((root) => {
    const out = [];
    const name = (el) => `${el.tagName}:${el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.textContent || '').trim().slice(0, 20)}`;
    for (const el of root.querySelectorAll('button, input, select, textarea, a[href]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) { out.push(`${name(el)} offscreen`); continue; }
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) out.push(name(el));
    }
    return out;
  });
  record(`${prefix} ${label}: all controls hit-testable`, blocked.length === 0, { blocked: blocked.slice(0, 8) });

  const focusInside = () => panel.evaluate((root) => root.contains(document.activeElement));
  record(`${prefix} ${label}: focus moved into dialog`, await focusInside());
  let escaped = false;
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
    if (!(await focusInside())) { escaped = true; break; }
  }
  record(`${prefix} ${label}: Tab focus trapped`, !escaped);

  await page.keyboard.press('Escape');
  const closedByEsc = await panel.isHidden({ timeout: 2000 }).catch(() => false);
  record(`${prefix} ${label}: Esc closes`, closedByEsc);
  if (closedByEsc && opener) {
    const restored = await opener.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false);
    record(`${prefix} ${label}: focus returns to opener`, restored);
  }
  return { panel };
}

async function closeWithButton(page, label, heading, open, prefix) {
  await open();
  const found = await findDialog(page, heading);
  if (!found) return record(`${prefix} ${label}: close button works`, false, { reason: 'dialog not found' });
  const close = found.panel.getByRole('button', { name: 'Close', exact: true }).first();
  const clicked = await close.click({ timeout: 3000 }).then(() => true).catch(() => false);
  record(`${prefix} ${label}: close button works`, clicked && (await found.panel.isHidden({ timeout: 2000 }).catch(() => false)));
}

async function adminRun(browser, viewportName, theme) {
  const prefix = `[admin ${viewportName} ${theme}]`;
  const context = await newContext(browser, 'admin', VIEWPORTS[viewportName], theme);
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/admin-dashboard-${viewportName}-${theme}.png` });

  record(`${prefix} nav: Sessions entry`, Boolean(await navEntry(page, 'Sessions')));
  if (viewportName === 'phone') await page.screenshot({ path: `${OUT}/admin-menu-${viewportName}-${theme}.png` });
  await closeMenu(page);
  record(`${prefix} nav: Projects entry`, Boolean(await navEntry(page, 'Projects')));
  await closeMenu(page);

  // Global token manager from the top nav.
  const tokens = await navEntry(page, 'Tokens', 'button');
  record(`${prefix} nav: Tokens entry (admin)`, Boolean(tokens));
  if (tokens) {
    const opener = viewportName === 'phone' ? page.getByRole('navigation').getByRole('button', { name: /menu/i }).first() : tokens;
    await tokens.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/admin-token-manager-${viewportName}-${theme}.png` });
    const found = await findDialog(page, 'Token manager');
    if (found) {
      const name = found.panel.getByPlaceholder(/Token name/);
      const typed = await name.fill('ui-check', { timeout: 2000 }).then(() => name.inputValue()).catch(() => '');
      record(`${prefix} token manager: name input accepts text`, typed === 'ui-check');
      const box = found.panel.getByRole('checkbox').first();
      const before = await box.isChecked().catch(() => null);
      await box.click({ timeout: 2000 }).catch(() => undefined);
      record(`${prefix} token manager: checkbox toggles`, before !== null && (await box.isChecked().catch(() => before)) !== before);
      await name.focus().catch(() => undefined);
    }
    await checkDialog(page, 'token manager', 'Token manager', opener, prefix);
    const reopen = await navEntry(page, 'Tokens', 'button');
    if (reopen) await closeWithButton(page, 'token manager', 'Token manager', () => reopen.click(), prefix);
  }

  // Per-session dialogs from the workspace.
  await page.goto(`${BASE}/dashboard?session=ses_ui_admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const manage = page.getByTitle('Manage issued tokens: rename, delete');
  if (await manage.isVisible().catch(() => false)) {
    await manage.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/admin-session-tokens-${viewportName}-${theme}.png` });
    await checkDialog(page, 'session tokens', 'Tokens —', manage, prefix);
    await closeWithButton(page, 'session tokens', 'Tokens —', () => manage.click(), prefix);
  } else record(`${prefix} session tokens: opener visible`, false);

  const generate = page.getByTitle('Create a default recording token for an agent');
  if (await generate.isVisible().catch(() => false)) {
    await generate.click();
    await page.getByText('Copy this token block now').first().waitFor({ timeout: 5000 }).catch(() => undefined);
    await page.screenshot({ path: `${OUT}/admin-token-display-${viewportName}-${theme}.png` });
    await checkDialog(page, 'token display', 'Copy this token block now', generate, prefix);
  } else record(`${prefix} token display: opener visible`, false);

  // Signed-in landing page.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const loginCta = await page.locator('main section').getByRole('link', { name: /login|log in/i }).count();
  const dashCta = await page.locator('main section').getByRole('link', { name: /dashboard|sessions/i }).count();
  record(`${prefix} landing: signed-in home offers sessions, not a login prompt`, loginCta === 0 && dashCta > 0, { loginCta, dashCta });
  await page.screenshot({ path: `${OUT}/admin-home-${viewportName}-${theme}.png` });

  // Projects pages.
  const api = await page.request.get(`${BASE}/api/v1/projects`);
  if (api.status() !== 404) {
    await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const listed = await page.getByRole('link', { name: /circtime/ }).first().isVisible().catch(() => false);
    record(`${prefix} projects: list shows seeded project`, listed);
    await page.screenshot({ path: `${OUT}/admin-projects-${viewportName}-${theme}.png`, fullPage: true });
    await page.goto(`${BASE}/projects/prj_ui`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const text = await page.locator('main').innerText().catch(() => '');
    record(`${prefix} project detail: workspaces, remotes, snippets, sessions`,
      text.includes('D:/Documents/Github/circtime') && text.includes('github.com/example/circtime') &&
      text.includes('/home/node/.openclaw/workspace/git/circtime') && text.includes('git clone') && text.includes('Deploy page via GitHub Actions'));
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    record(`${prefix} project detail: no horizontal overflow`, fits);
    await page.screenshot({ path: `${OUT}/admin-project-detail-${viewportName}-${theme}.png`, fullPage: true });
  }
  await context.close();
}

async function memberRun(browser, viewportName, theme) {
  const prefix = `[member ${viewportName} ${theme}]`;
  const context = await newContext(browser, 'member', VIEWPORTS[viewportName], theme);
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  record(`${prefix} nav: Sessions entry`, Boolean(await navEntry(page, 'Sessions')));
  await closeMenu(page);
  record(`${prefix} nav: no Tokens entry (member)`, !(await navEntry(page, 'Tokens', 'button')));
  await closeMenu(page);
  record(`${prefix} nav: no Settings entry (member)`, !(await navEntry(page, 'Settings')));
  await closeMenu(page);
  const listed = await page.request.get(`${BASE}/api/v1/sessions`);
  const ids = ((await listed.json().catch(() => ({}))).sessions || []).map((x) => x.id);
  const body = await page.locator('body').innerText();
  record(`${prefix} sessions: sees owned, not admin-only`, ids.includes('ses_ui_owned') && !ids.includes('ses_ui_admin') && body.includes('UI topic') && !body.includes('Unowned admin-only session'), { ids });
  await page.screenshot({ path: `${OUT}/member-dashboard-${viewportName}-${theme}.png` });
  const api = await page.request.get(`${BASE}/api/v1/projects`);
  if (api.status() !== 404) {
    const data = await api.json().catch(() => ({}));
    record(`${prefix} projects API: unowned project hidden from member`, api.status() === 200 && !(data.projects || []).some((p) => p.id === 'prj_ui'));
    const detail = await page.request.get(`${BASE}/api/v1/projects/prj_ui`);
    record(`${prefix} projects API: member gets 403 on unowned project`, detail.status() === 403);
  }
  await context.close();
}

const browser = await chromium.launch();
try {
  for (const viewportName of Object.keys(VIEWPORTS)) {
    for (const theme of ['light', 'dark']) {
      await adminRun(browser, viewportName, theme);
      await memberRun(browser, viewportName, theme);
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ summary: { checks: results.length, failed: failed.length } }));
process.exit(failed.length ? 1 : 0);
