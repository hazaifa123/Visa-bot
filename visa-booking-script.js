const { chromium } = require('playwright');
const fetch = require('node-fetch');
const readline = require('readline');

// Configuration
const TWO_CAPTCHA_KEY = '4b29fd7a5c40a53364d950b106fc7620'; 
const RECAPTCHA_SITE_KEY = '6LcnlCoUAAAAAJLjWXXaByTFyuOLf4K0gGu5r3d2';

// Enhanced data structure with validation
const validateAndFormatData = (data) => {
  if (!data.email || !data.phone || !data.dob) throw new Error("Missing required data");
  return {
    ...data,
    dob: {
      day: String(data.dob.day),
      month: String(data.dob.month),
      year: String(data.dob.year)
    },
    passportExpiry: {
      day: String(data.passportExpiry.day),
      month: data.passportExpiry.month.toLowerCase(),
      year: String(data.passportExpiry.year)
    }
  };
};

// Improved OTP handling with better selectors
async function handleOTP(page, otp) {
  try {
    // Find OTP input with multiple fallbacks
    const otpSelectors = [
      'input[name="otp"]',
      'input[id*="otp"]',
      'input[type="text"][maxlength="6"]',
      '#otp_input_field'
    ];
    
    let otpInput = null;
    for (const sel of otpSelectors) {
      if (await page.locator(sel).count() > 0) {
        otpInput = page.locator(sel);
        break;
      }
    }
    
    if (!otpInput) throw new Error("Could not find OTP input");
    
    await otpInput.fill(otp.trim());
    console.log("[+] OTP entered successfully");
    
    // Find verify button
    const verifyBtn = page.getByRole('button', { name: /verify|confirm|submit|continue/i });
    if (await verifyBtn.count() > 0) {
      await verifyBtn.click({ timeout: 5000 });
      console.log("[+] Verification submitted");
    } else {
      console.log("[!] Warning: Could not find verify button, continuing anyway");
    }
  } catch (err) {
    console.error("OTP handling error:", err.message);
    throw err;
  }
}

// Enhanced slot finder with better error handling
async function findAvailableSlot(page) {
  try {
    const MAX_ATTEMPTS = 30;
    let attempt = 0;
    
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      console.log(`[+] Attempting slot search (${attempt}/${MAX_ATTEMPTS})`);
      
      // Navigate to calendar
      await page.locator('#appointment_date').click();
      
      // Skip ahead to next month if needed
      if (attempt > 1) {
        await page.locator('.ui-datepicker-next').click();
      }
      
      // Wait for calendar to load
      await page.waitForTimeout(500);
      
      // Get available dates
      const dateLinks = page.locator('.ui-datepicker-calendar a:not(.ui-state-disabled)');
      const count = await dateLinks.count();
      
      if (count === 0) {
        console.log("[-] No dates available in current view");
        continue;
      }
      
      // Try each date
      for (let i = 0; i < Math.min(count, 7); i++) {
        const link = dateLinks.nth(i);
        const dateLabel = await link.textContent();
        
        console.log(`[+] Checking date: ${dateLabel}`);
        
        await link.click();
        await page.locator('#search_appointment').click();
        
        // Wait for results
        await page.waitForTimeout(1000);
        
        // Check for slots
        const slots = page.locator('div.appointment_slot.appointment_slot_enabled');
        if (await slots.count() > 0) {
          const firstSlot = slots.first();
          const time = await firstSlot.textContent();
          
          console.log(`[+] Found slot: ${time} on ${dateLabel}`);
          return { slot: firstSlot, date: dateLabel };
        }
        
        console.log(`[-] No slots available on ${dateLabel}`);
      }
    }
    
    throw new Error("No available slots found");
  } catch (err) {
    console.error("Slot finding error:", err.message);
    throw err;
  }
}

// Main function with improved error handling
async function main() {
  let browser;
  
  try {
    // Launch browser with options
    browser = await chromium.launch({ 
      headless: true,
      slowMo: 1000 // For debugging
    });
    
    const context = await browser.newContext({ storageState: 'session.json' });
    const page = await context.newPage();
    
    // Set timeouts
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    
    // Navigate to booking page
    await page.goto('https://pk-gr-services.gvcworld.eu/appointments/add', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // Handle initial reCAPTCHA
    await handleRecaptcha(page);
    
    // Fill form data
    await fillFormData(page, validateAndFormatData(data));
    
    // Find available slot
    const slotInfo = await findAvailableSlot(page);
    
    // Handle final reCAPTCHA
    await handleRecaptcha(page);
    
    // Submit form
    await page.getByRole('button', { name: /submit|book|complete/i }).click();
    
    console.log("[+] Booking completed successfully");
    
  } catch (err) {
    console.error("Booking error:", err.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();