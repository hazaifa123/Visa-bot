/**
 * visa-booking-script.js
 * - Automatically finds and selects the first available Date and Time Slot.
 * - Improved for CI: explicit waits, overlay handling, diagnostics on failure.
 */

const { chromium } = require('playwright');
const fs = require('fs');

async function saveDiagnostics(page, prefix = 'error') {
  try {
    const screenshotPath = `${prefix}-screenshot.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[+] Saved screenshot to ${screenshotPath}`);
  } catch (ssErr) {
    console.warn("[-] Failed to save screenshot:", ssErr.message || ssErr);
  }
  try {
    const html = await page.content();
    fs.writeFileSync(`${prefix}-page.html`, html, 'utf8');
    console.log(`[+] Saved page HTML to ${prefix}-page.html`);
  } catch (htmlErr) {
    console.warn("[-] Failed to save page HTML:", htmlErr.message || htmlErr);
  }
}

async function detectBlockingPage(page) {
  try {
    const url = page.url();
    const body = (await page.locator('body').innerText()).toLowerCase().slice(0, 4000);
    if (body.includes('captcha') || (await page.$('iframe[src*="captcha"]'))) {
      return 'captcha';
    }
    if (body.includes('login') || body.includes('sign in') || body.includes('sign-in') || body.includes('username')) {
      return 'login';
    }
    if (url.includes('auth') || url.includes('login')) {
      return 'login';
    }
  } catch (e) {
    // ignore detection errors
  }
  return null;
}

async function autoSelectAvailableDateAndTime(page) {
  console.log("[+] Searching for available Date and Time...");

  // Make page operations more tolerant on CI
  page.setDefaultTimeout(120000);

  // Wait for date input (try a few common selectors)
  const dateSelectorCandidates = '#datefrom, input[name="datefrom"], input[type="date"]';
  console.log("[+] Waiting for date input to appear...");

  // Retry the initial wait a few times because CI sites can be flaky
  const maxAttempts = 3;
  let foundDateSelector = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[+] Attempt ${attempt} waiting for selector...`);
      await page.waitForSelector(dateSelectorCandidates, { state: 'visible', timeout: 120000 });
      foundDateSelector = true;
      break;
    } catch (err) {
      console.warn(`[-] Attempt ${attempt} failed to find date input: ${err.message || err}`);
      if (attempt < maxAttempts) {
        const backoff = 2000 * attempt;
        console.log(`[+] Backing off ${backoff}ms before retrying...`);
        await page.waitForTimeout(backoff);
      }
    }
  }

  if (!foundDateSelector) {
    // Capture diagnostics and detect likely blocker
    console.error("[-] Date input not found after retries. Capturing diagnostics...");
    await saveDiagnostics(page);
    const blocker = await detectBlockingPage(page);
    if (blocker === 'captcha') {
      throw new Error('Selector not found: likely blocked by captcha (see diagnostics).');
    } else if (blocker === 'login') {
      throw new Error('Selector not found: likely redirected to login (session invalid or not restored).');
    }
    throw new Error('Selector not found: date input did not appear (see diagnostics).');
  }

  // Choose the first available selector that exists
  let calendarInput;
  if (await page.$('#datefrom')) {
    calendarInput = page.locator('#datefrom');
  } else if (await page.$('input[name="datefrom"]')) {
    calendarInput = page.locator('input[name="datefrom"]');
  } else {
    calendarInput = page.locator('input[type="date"]');
  }

  // Ensure input is in view and clickable
  await calendarInput.scrollIntoViewIfNeeded();
  try {
    await calendarInput.click({ timeout: 120000 });
  } catch (err) {
    console.warn("[-] Date input initial click failed, attempting overlay close and forced click:", err.message || err);
    // Try closing common overlays that might block clicks
    const overlaySelectors = [
      '.modal-close', '.cookie-accept', '.cookie-consent button', '.cookie-banner button',
      '.consent-btn', '.close', '#cookie-consent button'
    ];
    for (const sel of overlaySelectors) {
      try {
        const overlay = page.locator(sel);
        if (await overlay.count() > 0 && await overlay.isVisible()) {
          await overlay.first().click({ timeout: 5000, force: true }).catch(() => {});
          await page.waitForTimeout(400);
        }
      } catch (e) { /* ignore overlay close errors */ }
    }
    // Try forced click as a fallback
    await calendarInput.click({ force: true, timeout: 120000 });
  }

  await page.waitForTimeout(500);

  // Check up to 6 months ahead
  const maxMonths = 6;

  for (let month = 0; month < maxMonths; month++) {
    // Ensure calendar is visible for this month
    await page.waitForTimeout(300);
    if (!(await page.locator('.ui-datepicker-calendar').count() > 0)) {
      // If the calendar isn't present, try re-opening it
      try {
        await calendarInput.click({ timeout: 5000, force: false });
        await page.waitForTimeout(300);
      } catch (_) { /* ignore */ }
    }

    // Re-evaluate available date links in the current month view to avoid stale locators
    const availableDateLinks = page.locator('.ui-datepicker-calendar td:not(.ui-state-disabled) a');
    // Wait for the calendar grid to be attached or time out quickly if not
    try {
      await page.waitForSelector('.ui-datepicker-calendar', { state: 'visible', timeout: 10000 });
    } catch (_) {
      // Calendar not visible; continue to next month button or attempt to reopen
    }

    const dateCount = await availableDateLinks.count();
    console.log(`[+] Month ${month + 1}: Found ${dateCount} selectable date(s)`);

    for (let i = 0; i < dateCount; i++) {
      // Re-create locator each iteration to avoid stale element handles
      const dateElement = page.locator('.ui-datepicker-calendar td:not(.ui-state-disabled) a').nth(i);

      let dateText = await dateElement.textContent().catch(() => null);
      dateText = (dateText || '').trim() || `#${i + 1}`;

      console.log(`[+] Testing Date: Day ${dateText}`);

      // Click the date; if it fails, try scrolling and forced click
      try {
        await dateElement.scrollIntoViewIfNeeded();
        await dateElement.click({ timeout: 15000 });
      } catch (clickErr) {
        console.warn(`[-] Click on date ${dateText} failed: ${clickErr.message || clickErr}. Trying forced click.`);
        try {
          await dateElement.click({ force: true, timeout: 15000 });
        } catch (forcedErr) {
          console.warn(`[-] Forced click on date ${dateText} also failed; skipping this date.`);
          // Try re-opening calendar (sometimes it closes) then continue
          try {
            if (!(await page.locator('.ui-datepicker-calendar').isVisible())) {
              await calendarInput.click({ timeout: 5000, force: true });
              await page.waitForTimeout(400);
            }
          } catch (_) {}
          continue;
        }
      }

      // Wait a short while for time slots to load (AJAX)
      await page.waitForTimeout(1200);

      // Wait up to a short timeout for appointment containers to appear (non-blocking)
      const appointmentContainerPresent = await page.locator('#appointmentmethodDiv, #appointment_box').count() > 0;
      if (appointmentContainerPresent) {
        // Look for known time slot elements: radio inputs, labels, or generic slot blocks
        const timeSlots = page.locator('#appointmentmethodDiv input[type="radio"], #appointmentmethodDiv label, #appointment_box .appointment_slot, #appointment_box .slot, .appointment_slot');
        const slotCount = await timeSlots.count();

        console.log(`[+] Found ${slotCount} time slot element(s) after selecting Day ${dateText}`);

        if (slotCount > 0) {
          // Pick the first actionable slot and click it
          const firstSlot = timeSlots.first();

          // Try to read a human-friendly time label
          let timeText = await firstSlot.textContent().catch(() => null);
          timeText = (timeText || '').trim();

          // If text is empty and it's an input radio, try to get the associated label or value
          if (!timeText) {
            try {
              const tagName = (await firstSlot.evaluate(node => node.tagName)).toLowerCase();
              if (tagName === 'input') {
                // Try to find a sibling label that references the input's id
                const id = await firstSlot.getAttribute('id');
                if (id) {
                  const label = page.locator(`label[for="${id}"]`);
                  if ((await label.count()) > 0) {
                    timeText = (await label.textContent()).trim();
                  }
                }
                if (!timeText) {
                  // fallback to value attribute
                  timeText = (await firstSlot.getAttribute('value')) || '';
                }
              } else {
                // fallback to outer text
                timeText = (await firstSlot.textContent()) || '';
              }
            } catch (_) {
              timeText = timeText || '';
            }
            timeText = timeText.trim();
          }

          // Click the slot (try normal then forced)
          try {
            await firstSlot.click({ timeout: 15000 });
          } catch (slotClickErr) {
            console.warn("[-] Normal click on time slot failed:", slotClickErr.message || slotClickErr);
            try {
              await firstSlot.click({ force: true, timeout: 15000 });
            } catch (forceSlotErr) {
              console.error("[-] Forced click on time slot failed:", forceSlotErr.message || forceSlotErr);
              // continue searching other dates
              try {
                if (!(await page.locator('.ui-datepicker-calendar').isVisible())) {
                  await calendarInput.click({ force: true, timeout: 5000 });
                }
              } catch (_) {}
              continue;
            }
          }

          console.log(`\n==============================================`);
          console.log(`[SUCCESS] Selected Date : Day ${dateText}`);
          console.log(`[SUCCESS] Selected Time : ${timeText || 'First Slot'}`);
          console.log(`==============================================\n`);

          return { date: dateText, time: timeText || 'Slot 1' };
        } else {
          console.log(`[-] No time slots available on Day ${dateText}`);
        }
      } else {
        console.log(`[-] Appointment containers not present after selecting Day ${dateText}`);
      }

      // If calendar closed, re-open it so we can continue iterating
      try {
        if (!(await page.locator('.ui-datepicker-calendar').isVisible())) {
          await calendarInput.click({ timeout: 5000 });
          await page.waitForTimeout(400);
        }
      } catch (_) { /* ignore */ }
    } // end for each date in month

    // No slots found this month: move to next month if possible
    const nextMonthBtn = page.locator('.ui-datepicker-next');
    if (await nextMonthBtn.count() > 0 && await nextMonthBtn.isVisible()) {
      console.log("[+] Moving to next month...");
      try {
        await nextMonthBtn.click({ timeout: 5000 });
      } catch (nextErr) {
        console.warn("[-] Next month click failed, trying forced click:", nextErr.message || nextErr);
        try { await nextMonthBtn.click({ force: true, timeout: 5000 }); } catch (_) { break; }
      }
      await page.waitForTimeout(600);
    } else {
      // Can't navigate further
      break;
    }
  } // end months loop

  throw new Error("No available dates or time slots found.");
}

// Main Execution
async function main() {
  // Allow overriding headless from environment; default = true (safe for CI)
  const headless = process.env.HEADLESS ? process.env.HEADLESS !== 'false' : true;

  const browser = await chromium.launch({
    headless,
    // recommended flags for running Chromium on CI (GitHub Actions)
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-dev-tools',
      // removed '--single-process' because it can cause instability in CI
      '--disable-background-networking'
    ]
  });

  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    // Increase timeouts globally for CI
    context.setDefaultTimeout(120000);
    page.setDefaultTimeout(120000);

    console.log("[+] Navigating to GVC World appointment page...");
    const response = await page.goto('https://pk-gr-services.gvcworld.eu/appointments/add', {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    console.log(`[+] Navigation status: ${response ? response.status() : 'no-response'}, URL: ${page.url()}`);

    // Wait for body or main container so we reduce race conditions
    try {
      await page.waitForSelector('body', { timeout: 120000 });
    } catch (e) {
      console.warn("[-] Body did not appear in time:", e.message || e);
    }

    // Run Auto Selector
    await autoSelectAvailableDateAndTime(page);

    console.log("[+] Done!");
  } catch (err) {
    console.error("[-] Script error:", err && err.message ? err.message : err);

    // Try to save diagnostics (screenshot + HTML) if page is available
    try {
      if (context) {
        const pages = context.pages();
        if (pages.length > 0) {
          const p = pages[0];
          await saveDiagnostics(p);
        }
      }
    } catch (diagErr) {
      console.warn("[-] Failed to capture diagnostics:", diagErr.message || diagErr);
    }

    throw err;
  } finally {
    try {
      if (context) await context.close();
      await browser.close();
    } catch (closeErr) {
      console.warn("[-] Error closing browser/context:", closeErr.message || closeErr);
    }
  }
}

main().catch(async err => {
  console.error("Fatal error:", err && err.message ? err.message : err);
  process.exit(1);
});
