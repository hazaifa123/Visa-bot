require('dotenv').config();
const { chromium } = require('playwright');
const fetch = require('node-fetch');
const fs = require('fs');

// Configuration - loaded from environment (GitHub Secrets locally from .env)
const TWO_CAPTCHA_KEY = process.env.TWO_CAPTCHA_KEY;
const RECAPTCHA_SITE_KEY = '6LcnlCoUAAAAAJLjWXXaByTFyuOLf4K0gGu5r3d2';
const VISA_USERNAME = process.env.VISA_USERNAME;
const VISA_PASSWORD = process.env.VISA_PASSWORD;
const LOGIN_URL = 'https://pk-gr-services.gvcworld.eu/?lang=en_US';

// Solve reCAPTCHA using 2Captcha API
async function solveRecaptcha(pageUrl) {
  console.log('[INFO] Submitting captcha to 2Captcha...');

  // Step 1: submit the captcha job
  // enterprise=1 is required because this site uses reCAPTCHA Enterprise
  // (confirmed by the "exceeding reCAPTCHA Enterprise free quota" message on the login page)
  const submitRes = await fetch(
    `http://2captcha.com/in.php?key=${TWO_CAPTCHA_KEY}&method=userrecaptcha&googlekey=${RECAPTCHA_SITE_KEY}&pageurl=${pageUrl}&enterprise=1&json=1`
  );
  const submitData = await submitRes.json();

  if (submitData.status !== 1) {
    throw new Error(`2Captcha submit failed: ${submitData.request}`);
  }

  const requestId = submitData.request;
  console.log(`[INFO] Captcha job submitted, id: ${requestId}. Waiting for solution...`);

  // Step 2: poll for the result
  const maxAttempts = 24; // ~2 minutes at 5s intervals
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 5000));

    const resultRes = await fetch(
      `http://2captcha.com/res.php?key=${TWO_CAPTCHA_KEY}&action=get&id=${requestId}&json=1`
    );
    const resultData = await resultRes.json();

    if (resultData.status === 1) {
      console.log('[SUCCESS] Captcha solved');
      return resultData.request; // this is the g-recaptcha-response token
    }

    if (resultData.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`2Captcha error: ${resultData.request}`);
    }
    console.log(`[INFO] Still waiting on captcha (${attempt + 1}/${maxAttempts})...`);
  }

  throw new Error('2Captcha timed out waiting for a solution');
}

// Inject the solved token into the page's recaptcha response field
async function applyRecaptchaToken(page, token) {
  await page.evaluate((token) => {
    // Standard reCAPTCHA hidden textarea used to receive the token
    let el = document.getElementById('g-recaptcha-response');
    if (el) {
      el.style.display = 'block';
      el.value = token;
    }
    // Some sites also expect a callback to fire
    if (window.___grecaptcha_cfg) {
      Object.values(window.___grecaptcha_cfg.clients || {}).forEach(client => {
        Object.values(client || {}).forEach(obj => {
          if (obj && obj.callback) {
            try { obj.callback(token); } catch (e) { /* ignore */ }
          }
        });
      });
    }
  }, token);
}

async function login() {
  if (!VISA_USERNAME || !VISA_PASSWORD) {
    throw new Error('VISA_USERNAME or VISA_PASSWORD not set in environment');
  }
  if (!TWO_CAPTCHA_KEY) {
    throw new Error('TWO_CAPTCHA_KEY not set in environment');
  }

  console.log('[INFO] Starting automated login...');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);

    console.log('[INFO] Navigating to login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });

    // Debug: capture what the page actually looks like in this run
    await page.screenshot({ path: 'debug-after-navigate.png', fullPage: true });
    console.log('[INFO] Saved debug-after-navigate.png for inspection');

    // --- Fill credentials ---
    // Confirmed via browser inspect element on the real login page
    await page.fill('#username', VISA_USERNAME);
    await page.fill('#password', VISA_PASSWORD);

    // --- Solve and apply captcha ---
    const token = await solveRecaptcha(page.url());
    await applyRecaptchaToken(page, token);

    // --- Submit login form ---
    const loginBtn = page.getByRole('button', { name: /log ?in|sign ?in|submit/i });
    await loginBtn.click();

    // Wait for navigation to confirm login succeeded
    await page.waitForLoadState('networkidle');

    // --- Save session ---
    await context.storageState({ path: 'session.json' });
    console.log('[SUCCESS] Session saved to session.json');

    if (fs.existsSync('session.json')) {
      const stat = fs.statSync('session.json');
      console.log(`[INFO] Session file size: ${stat.size} bytes`);
    } else {
      throw new Error('Failed to create session.json');
    }

    await browser.close();
  } catch (err) {
    await browser.close();
    console.error('[ERROR] Login failed:', err.message);
    process.exit(1);
  }
}

login();