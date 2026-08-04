const { chromium } = require('playwright');
const fetch = require('node-fetch');
const readline = require('readline');

// Configuration
const TWO_CAPTCHA_KEY = '4b29fd7a5c40a53364d950b106fc7620'; 
const RECAPTCHA_SITE_KEY = '6LcnlCoUAAAAAJLjWXXaByTFyuOLf4K0gGu5r3d2';

// Sample User Data (Change according to your needs)
const data = {
  email: 'user@example.com',
  phone: '03001234567',
  gender: 'M', // 'M' for Male, 'F' for Female
  dob: { day: '15', month: '05', year: '1995' }, // Format: DD/MM/YYYY
  passportExpiry: { day: '10', month: 'aug', year: '2030' }
};

const validateAndFormatData = (data) => {
  if (!data.email || !data.phone || !data.dob) throw new Error("Missing required data");
  return {
    ...data,
    dobFormatted: `${String(data.dob.day).padStart(2, '0')}/${String(data.dob.month).padStart(2, '0')}/${data.dob.year}`,
    dob: {
      day: String(data.dob.day),
      month: String(data.dob.month),
      year: String(data.dob.year)
    }
  };
};

// ==========================================
// 1. FIX: DOB & GENDER FILL FUNCTION
// ==========================================
async function fillFormData(page, formData) {
  try {
    console.log("[+] Filling Form Data...");

    // 1. Fill Gender (Supports Radio Button or Select Dropdown)
    const genderSelect = page.locator('select[name="gender"], #gender');
    const genderRadio = page.locator(`input[name="gender"][value="${formData.gender}"], #gender_${formData.gender}`);

    if (await genderSelect.count() > 0) {
      await genderSelect.selectOption(formData.gender);
      console.log("[+] Gender selected (Dropdown)");
    } else if (await genderRadio.count() > 0) {
      await genderRadio.check({ force: true }); // Force click to bypass custom label CSS
      console.log("[+] Gender selected (Radio)");
    }

    // 2. Fill Date of Birth (DOB)
    const dobSelector = '#dob, input[name="dob"], input[name="date_of_birth"]';
    const dobInput = page.locator(dobSelector);

    if (await dobInput.count() > 0) {
      // Inject date via JavaScript to trigger website's validation scripts
      await page.evaluate(({ selector, dateStr }) => {
        const input = document.querySelector(selector);
        if (input) {
          input.removeAttribute('readonly');
          input.value = dateStr;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      }, { selector: dobSelector, dateStr: formData.dobFormatted });

      console.log(`[+] Date of Birth set to: ${formData.dobFormatted}`);
    } else {
      console.log("[!] Warning: DOB field not found with standard selector");
    }

  } catch (err) {
    console.error("Form filling error:", err.message);
    throw err;
  }
}

// ==========================================
// 2. FIX: APPOINTMENT CALENDAR SLOT FINDER
// ==========================================
async function findAvailableSlot(page) {
  try {
    const MAX_ATTEMPTS = 30;
    let attempt = 0;
    
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      console.log(`[+] Attempting slot search (${attempt}/${MAX_ATTEMPTS})`);
      
      // FIXED: Correct ID for GVC World calendar is '#datefrom'
      const calendarInput = page.locator('#datefrom');
      await calendarInput.click();
      await page.waitForTimeout(500);

      // Next month navigation if needed
      if (attempt > 1) {
        const nextBtn = page.locator('.ui-datepicker-next');
        if (await nextBtn.isVisible()) {
          await nextBtn.click();
          await page.waitForTimeout(500);
        }
      }
      
      // Get available (selectable) dates in jQuery UI Datepicker
      const dateLinks = page.locator('.ui-datepicker-calendar td:not(.ui-state-disabled) a');
      const count = await dateLinks.count();
      
      if (count === 0) {
        console.log("[-] No dates available in current calendar view");
        continue;
      }
      
      // Try clicking dates
      for (let i = 0; i < Math.min(count, 7); i++) {
        const link = dateLinks.nth(i);
        const dateLabel = await link.textContent();
        
        console.log(`[+] Checking date: ${dateLabel}`);
        await link.click();
        
        // Wait for appointment box / slot div to update via AJAX
        await page.waitForTimeout(1200);
        
        // Check if slots are visible in resultMessage or appointment_box
        const slots = page.locator('#appointment_box .appointment_slot, .appointment_slot_enabled, #appointmentmethodDiv div');
        if (await slots.count() > 0) {
          const firstSlot = slots.first();
          const time = await firstSlot.textContent();
          
          console.log(`[+] Found available slot: ${time.trim()} on date ${dateLabel}`);
          await firstSlot.click();
          return { slot: firstSlot, date: dateLabel };
        }
        
        console.log(`[-] No slots available on date ${dateLabel}`);
      }
    }
    
    throw new Error("No available slots found");
  } catch (err) {
    console.error("Slot finding error:", err.message);
    throw err;
  }
}

// Dummy captcha handler placeholder
async function handleRecaptcha(page) {
  console.log("[+] Handling reCAPTCHA...");
  await page.waitForTimeout(1000);
}

// Main function
async function main() {
  let browser;
  
  try {
    browser = await chromium.launch({ 
      headless: false, // Set to false to see what browser is doing
      slowMo: 500
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    
    console.log("[+] Navigating to GVC World appointment page...");
    await page.goto('https://pk-gr-services.gvcworld.eu/appointments/add', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // Fill form data (DOB, Gender, etc.)
    await fillFormData(page, validateAndFormatData(data));
    
    // Find available slot from calendar
    const slotInfo = await findAvailableSlot(page);
    
    console.log("[+] Slot selected successfully:", slotInfo);
    
  } catch (err) {
    console.error("Booking error:", err.message);
  }
}

main();
