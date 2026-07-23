const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log('[INFO] Starting manual login process...');
  
  try {
    // Launch browser with headless mode disabled for manual login
    const browser = await chromium.launch({ 
      headless: false,
      slowMo: 100 // For easier debugging
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Navigate to login page
    console.log('[INFO] Navigating to login page...');
    await page.goto('https://pk-gr-services.gvcworld.eu/?lang=en_US');
    
    // Provide clear instructions
    console.log("\n[INSTRUCTIONS]");
    console.log("- Login manually in the opened browser window");
    console.log("- Solve any CAPTCHA challenges if prompted");
    console.log("- Wait until you see the dashboard/home page");
    console.log("- Press Enter when ready to save session\n");
    
    // Wait for user confirmation
    await new Promise(resolve => {
      process.stdin.once('data', () => {
        console.log('[INFO] Received confirmation, saving session...\n');
        resolve();
      });
    });
    
    // Save session state
    await context.storageState({ path: 'session.json' });
    console.log('[SUCCESS] Session saved to session.json');
    
    // Verify session file was created
    if (fs.existsSync('session.json')) {
      const stat = fs.statSync('session.json');
      console.log(`[INFO] Session file size: ${stat.size} bytes`);
    } else {
      throw new Error("Failed to create session.json");
    }
    
    // Close browser
    await browser.close();
    console.log('[INFO] Browser closed successfully');
    
  } catch (err) {
    console.error('[ERROR] Process failed:', err.message);
    process.exit(1);
  }
})();