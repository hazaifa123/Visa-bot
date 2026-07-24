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

  next(); // continue if validation passes
};

// Root route
app.get('/', (req, res) => {
  res.send('Visa Bot is running!');
});

// Booking route
app.post('/book', validateBookingData, async (req, res) => {
  const { preferred_date } = req.body;

  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Example automation step
    await page.goto('https://visa-portal.example.com');

    await browser.close();

    res.json({
      status: 'success',
      message: `Booking attempted for ${preferred_date}`
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
