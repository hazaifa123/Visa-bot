const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const app = express();
app.use(express.json());

// Input validation middleware
const validateBookingData = (req, res, next) => {
  const { preferred_date } = req.body;
  
  if (!preferred_date) {
    return res.status(400).json({ 
      status: 'error', 
      message: 'Preferred date is required' 
    });
  }
  
  // Format check (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(preferred_date)) {
    return res.status(400).json({ 
      status: 'error', 
      message: 'Invalid date format. Use YYYY-MM-DD' 
    });
  }
  
  next();
};

// Session validation middleware
const validateSession = (req, res, next) => {
  if (!fs.existsSync('session.json')) {
    return res.status(400).json({ 
      status: 'error', 
      message: 'Session expired or missing — run login-once.js again' 
    });
  }
  next();
};

// Main booking endpoint
app.post('/book-slot', validateBookingData, validateSession, async (req, res) => {
  const { preferred_date } = req.body;
  let browser;
  
  try {
    console.log(`[INFO] Starting booking process for date: ${preferred_date}`);
    
    // Launch browser
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] // For containerized environments
    });
    
    // Create context with session
    const context = await browser.newContext({ storageState: 'session.json' });
    const page = await context.newPage();
    
    // Set timeouts
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    
    // Go to homepage
    await page.goto('https://pk-gr-services.gvcworld.eu/?lang=en_US');
    await page.waitForLoadState('networkidle');
    
    // Verify session is still valid
    const isLoggedOut = await page.locator('input[type="password"]').isVisible()
      .catch(() => false);
      
    if (isLoggedOut) {
      console.log('[WARNING] Session expired during booking process');
      return res.status(401).json({ 
        status: 'session_expired', 
        message: 'Session expired — run login-once.js again' 
      });
    }
    
    // Booking logic would go here with actual selectors
    
    // Close browser and respond
    await browser.close();
    
    console.log(`[SUCCESS] Booking confirmed for ${preferred_date}`);
    res.json({ 
      status: 'confirmed', 
      booking_date: preferred_date 
    });
    
  } catch (err) {
    console.error('[ERROR] Booking process failed:', err.message);
    if (browser) await browser.close();
    
    // Return specific error codes for different failure types
    if (err.message.includes('timeout')) {
      return res.status(504).json({ 
        status: 'timeout', 
        message: 'Booking process timed out' 
      });
    }
    
    res.status(500).json({ 
      status: 'error', 
      message: err.message 
    });
  }
});

// Start server
app.listen(3000, () => {
  console.log('Visa bot service running on port 3000');
});