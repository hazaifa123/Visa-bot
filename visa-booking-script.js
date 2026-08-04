const { chromium } = require('playwright');

/**
 * Automatically finds and selects the first available Date and Time Slot
 */
async function autoSelectAvailableDateAndTime(page) {
  console.log("[+] Searching for available Date and Time...");
  
  // 1. Open the datepicker calendar
  const calendarInput = page.locator('#datefrom');
  await calendarInput.click();
  await page.waitForTimeout(500);

  // Check up to 6 months ahead
  const maxMonths = 6;
  
  for (let month = 0; month < maxMonths; month++) {
    // Locate all selectable dates in the calendar
    const availableDateLinks = page.locator('.ui-datepicker-calendar td:not(.ui-state-disabled) a');
    const dateCount = await availableDateLinks.count();
    
    console.log(`[+] Month ${month + 1}: Found ${dateCount} selectable date(s)`);

    // Loop through each available date in the current month view
    for (let i = 0; i < dateCount; i++) {
      const dateElement = availableDateLinks.nth(i);
      const dateText = await dateElement.textContent();
      
      console.log(`[+] Testing Date: Day ${dateText.trim()}`);
      
      // Click the date
      await dateElement.click();
      
      // Wait for AJAX time slots to load from server
      await page.waitForTimeout(1200);
      
      // Check for available time slots in container (#appointmentmethodDiv or #appointment_box)
      const timeSlots = page.locator('#appointmentmethodDiv input[type="radio"], #appointmentmethodDiv label, #appointment_box .appointment_slot');
      const slotCount = await timeSlots.count();
      
      if (slotCount > 0) {
        // 2. AUTOMATICALLY SELECT THE FIRST TIME SLOT
        const firstSlot = timeSlots.first();
        const timeText = await firstSlot.textContent();
        
        await firstSlot.click({ force: true });
        
        console.log(`\n==============================================`);
        console.log(`[SUCCESS] Selected Date : Day ${dateText.trim()}`);
        console.log(`[SUCCESS] Selected Time : ${timeText ? timeText.trim() : 'First Slot'}`);
        console.log(`==============================================\n`);
        
        return { date: dateText.trim(), time: timeText ? timeText.trim() : 'Slot 1' };
      } else {
        console.log(`[-] No time slots available on Day ${dateText.trim()}`);
      }

      // Re-open calendar if it closed
      if (!(await page.locator('.ui-datepicker-calendar').isVisible())) {
        await calendarInput.click();
        await page.waitForTimeout(400);
      }
    }

    // Go to next month if no slots found in this month
    const nextMonthBtn = page.locator('.ui-datepicker-next');
    if (await nextMonthBtn.isVisible()) {
      console.log("[+] Moving to next month...");
      await nextMonthBtn.click();
      await page.waitForTimeout(600);
    } else {
      break;
    }
  }

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
      '--single-process',
      '--disable-background-networking'
    ]
  });

  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    console.log("[+] Navigating to GVC World appointment page...");
    await page.goto('https://pk-gr-services.gvcworld.eu/appointments/add', {
      waitUntil: 'networkidle'
    });

    // Run Auto Selector
    await autoSelectAvailableDateAndTime(page);

    console.log("[+] Done!");
  } catch (err) {
    console.error("[-] Script error:", err);
    throw err;
  } finally {
    try {
      if (context) await context.close();
      await browser.close();
    } catch (closeErr) {
      console.warn("[-] Error closing browser/context:", closeErr);
    }
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
