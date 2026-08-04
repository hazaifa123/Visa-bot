require('dotenv').config();
const { chromium } = require('playwright');
const fetch = require('node-fetch');

// Configuration
const TWO_CAPTCHA_KEY = process.env.TWO_CAPTCHA_KEY || '4b29fd7a5c40a53364d950b106fc7620';
const RECAPTCHA_SITE_KEY = '6LcnlCoUAAAAAJLjWXXaByTFyuOLf4K0gGu5r3d2';

const bookingData = {
  email: process.env.VISA_EMAIL || 'user@example.com',
  phone: process.env.VISA_PHONE || '03001234567',
  dob: {
    day: process.env.VISA_DOB_DAY || '01',
    month: process.env.VISA_DOB_MONTH || '01',
    year: process.env.VISA_DOB_YEAR || '1990'
  },
  passportExpiry: {
    day: process.env.VISA_PASSPORT_EXPIRY_DAY || '01',
    month: process.env.VISA_PASSPORT_EXPIRY_MONTH || '12',
    year: process.env.VISA_PASSPORT_EXPIRY_YEAR || '2030'
  }
};

const validateAndFormatData = (data) => {
  if (!data.email || !data.phone || !data.dob) {
    throw new Error('Missing required booking data');
  }

  return {
    ...data,
    dob: {
      day: String(data.dob.day),
      month: String(data.dob.month),
      year: String(data.dob.year)
    },
    passportExpiry: {
      day: String(data.passportExpiry.day),
      month: String(data.passportExpiry.month).toLowerCase(),
      year: String(data.passportExpiry.year)
    }
  };
};

async function solveRecaptcha(pageUrl) {
  console.log('[+] Submitting captcha to 2Captcha...');

  const submitRes = await fetch(
    `http://2captcha.com/in.php?key=${TWO_CAPTCHA_KEY}&method=userrecaptcha&googlekey=${RECAPTCHA_SITE_KEY}&pageurl=${pageUrl}&enterprise=1&json=1`
  );
  const submitData = await submitRes.json();

  if (submitData.status !== 1) {
    throw new Error(`2Captcha submit failed: ${submitData.request}`);
  }

  const requestId = submitData.request;
  console.log(`[+] Captcha job submitted, id: ${requestId}. Waiting for solution...`);

  const maxAttempts = 24;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const resultRes = await fetch(
      `http://2captcha.com/res.php?key=${TWO_CAPTCHA_KEY}&action=get&id=${requestId}&json=1`
    );
    const resultData = await resultRes.json();

    if (resultData.status === 1) {
      console.log('[+] Captcha solved');
      return resultData.request;
    }

    if (resultData.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`2Captcha error: ${resultData.request}`);
    }

    console.log(`[+] Waiting for captcha solution (${attempt + 1}/${maxAttempts})...`);
  }

  throw new Error('2Captcha timed out waiting for a solution');
}

async function injectRecaptchaToken(page, token) {
  await page.evaluate((token) => {
    const textarea = document.getElementById('g-recaptcha-response');
    if (textarea) {
      textarea.style.display = 'block';
      textarea.value = token;
    }

    if (window.___grecaptcha_cfg) {
      Object.values(window.___grecaptcha_cfg.clients || {}).forEach((client) => {
        Object.values(client || {}).forEach((obj) => {
          if (obj && typeof obj.callback === 'function') {
            try {
              obj.callback(token);
            } catch (error) {
              console.warn('Captcha callback error:', error);
            }
          }
        });
      });
    }
  }, token);
}

async function handleRecaptcha(page) {
  const hasRecaptcha =
    (await page.locator('iframe[src*="recaptcha"]').count()) > 0 ||
    (await page.locator('#g-recaptcha-response').count()) > 0;

  if (!hasRecaptcha) {
    return;
  }

  const token = await solveRecaptcha(page.url());
  await injectRecaptchaToken(page, token);
  await page.waitForTimeout(1500);
}

async function fillFormData(page, data) {
  const fill = async (selector, value) => {
    const locator = page.locator(selector);
    if (await locator.count() > 0) {
      await locator.fill(value);
      return true;
    }
    return false;
  };

  await fill('input[name="email"], input#email', data.email);
  await fill('input[name="phone"], input#phone, input[name="mobile"]', data.phone);
  await fill('input[name="dob_day"], input#dob_day, input[name="day"]', data.dob.day);
  await fill('input[name="dob_month"], input#dob_month, input[name="month"]', data.dob.month);
  await fill('input[name="dob_year"], input#dob_year, input[name="year"]', data.dob.year);
  await fill('input[name="passportExpiry_day"], input#passport_expiry_day, input[name="passport_day"]', data.passportExpiry.day);
  await fill('input[name="passportExpiry_month"], input#passport_expiry_month, input[name="passport_month"]', data.passportExpiry.month);
  await fill('input[name="passportExpiry_year"], input#passport_expiry_year, input[name="passport_year"]', data.passportExpiry.year);

  console.log('[+] Booking form data filled');
}

async function findAvailableSlot(page) {
  const MAX_ATTEMPTS = 30;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[+] Attempting slot search (${attempt}/${MAX_ATTEMPTS})`);

    await page.locator('#appointment_date').click();
    if (attempt > 1) {
      const nextButton = page.locator('.ui-datepicker-next');
      if (await nextButton.count() > 0) {
        await nextButton.click();
      }
    }

    await page.waitForTimeout(700);
    const dateLinks = page.locator('.ui-datepicker-calendar a:not(.ui-state-disabled)');
    const count = await dateLinks.count();

    if (count === 0) {
      console.log('[-] No dates available in current view');
      continue;
    }

    for (let i = 0; i < Math.min(count, 7); i++) {
      const link = dateLinks.nth(i);
      const dateLabel = (await link.textContent())?.trim() || `date-${i + 1}`;

      console.log(`[+] Checking date: ${dateLabel}`);
      await link.click();
      await page.locator('#search_appointment').click();
      await page.waitForTimeout(1200);

      const slots = page.locator('div.appointment_slot.appointment_slot_enabled');
      if (await slots.count() > 0) {
        const slot = slots.first();
        const time = (await slot.textContent())?.trim() || 'unknown time';
        console.log(`[+] Found slot: ${time} on ${dateLabel}`);
        return { slot, date: dateLabel, time };
      }

      console.log(`[-] No slots available on ${dateLabel}`);
    }
  }

  throw new Error('No available slots found');
}

async function main() {
  let browser;

  try {
    browser = await chromium.launch({ headless: true, slowMo: 1000 });
    const context = await browser.newContext({ storageState: 'session.json' });
    const page = await context.newPage();

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);

    await page.goto('https://pk-gr-services.gvcworld.eu/appointments/add', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await handleRecaptcha(page);
    await fillFormData(page, validateAndFormatData(bookingData));

    const slotInfo = await findAvailableSlot(page);
    await slotInfo.slot.click();
    console.log(`[+] Selected appointment slot: ${slotInfo.date} at ${slotInfo.time}`);

    await page.waitForTimeout(500);
    await handleRecaptcha(page);

    const submitBtn = page.getByRole('button', { name: /submit|book|complete|confirm/i });
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
    } else {
      const fallback = page.locator('button[type="submit"], input[type="submit"], button:has-text("Book"), button:has-text("Confirm")');
      if (await fallback.count() > 0) {
        await fallback.first().click();
      } else {
        throw new Error('Unable to find booking submit button');
      }
    }

    console.log('[+] Booking completed successfully');
    await browser.close();
  } catch (err) {
    console.error('Booking error:', err.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();

