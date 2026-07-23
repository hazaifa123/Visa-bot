const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    // Go to login page
    await page.goto('https://pk-gr-services.gvcworld.eu/?lang=en_US');
    
    // Get credentials from environment
    const USERNAME = process.env.VISA_PORTAL_USER;
    const PASSWORD = process.env.VISA_PORTAL_PASS;
    
    if (!USERNAME || !PASSWORD) {
      throw new Error("Username or password not set in environment variables");
    }
    
    // Fill login form with fallback selectors
    await page.fill('input[name="email"], input[name="username"]', USERNAME);
    await page.fill('input[name="password"]', PASSWORD);
    
    // Click submit button with explicit wait
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.click('button[type="submit"]')
    ]);
    
    // Verify login success by checking for user-specific element
    const welcomeText = await page.locator('text=Welcome').textContent();
    if (!welcomeText) {
      throw new Error("Login failed - welcome message not found");
    }
    
    console.log('Logged in successfully, current URL:', page.url());
    
    // Continue with navigation...
    
  } catch (err) {
    console.error('Login error:', err.message);
    await page.screenshot({ path: 'login-error.png' });
  } finally {
    await browser.close();
  }
})();