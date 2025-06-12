require('dotenv').config();
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const axios = require('axios');

const URL = 'https://shop.amul.com/en/product/amul-high-protein-buttermilk-200-ml-or-pack-of-30';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_USER_ID = process.env.EMAILJS_USER_ID;
const PINCODE = process.env.PINCODE || '360001'; // Default to Rajkot

let lastStatus = null;

async function checkAvailability() {
  console.log(`[${new Date().toISOString()}] Checking availability...`);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // Navigate to the product page
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Handle pincode popup if it appears
    try {
      await page.waitForSelector('#pincode-modal', { timeout: 5000 });
      console.log('Pincode popup detected, filling it...');
      
      await page.type('#pincode-input', PINCODE);
      await page.click('#pincode-submit');
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log('No pincode popup or already handled');
    }
    
    // Wait for page to load completely
    await page.waitForTimeout(3000);
    
    // Check for availability indicators
    let isAvailable = false;
    let statusText = 'Unknown';
    
    try {
      // Look for "Add to Cart" button
      const addToCartBtn = await page.$('.add-to-cart, .btn-add-cart, [data-testid="add-to-cart"]');
      if (addToCartBtn) {
        const btnText = await page.evaluate(el => el.textContent, addToCartBtn);
        if (btnText.toLowerCase().includes('add to cart')) {
          isAvailable = true;
          statusText = 'Available';
        }
      }
      
      // Check for out of stock indicators
      const outOfStockElements = await page.$$eval('*', els => 
        els.filter(el => 
          el.textContent.toLowerCase().includes('out of stock') ||
          el.textContent.toLowerCase().includes('not available') ||
          el.textContent.toLowerCase().includes('unavailable')
        ).map(el => el.textContent)
      );
      
      if (outOfStockElements.length > 0) {
        isAvailable = false;
        statusText = 'Out of Stock';
      }
      
    } catch (error) {
      console.error('Error checking availability selectors:', error);
      statusText = 'Error checking status';
    }
    
    console.log(`Status: ${statusText}`);
    
    // Send notification if status changed
    if (lastStatus !== null && lastStatus !== statusText) {
      await sendNotifications(statusText, isAvailable);
    }
    
    lastStatus = statusText;
    
  } catch (error) {
    console.error('Error during availability check:', error);
    
    // Send error notification if this is a persistent issue
    if (lastStatus !== 'Error') {
      await sendNotifications('Error checking availability', false, true);
      lastStatus = 'Error';
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function sendTelegramMessage(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram credentials not configured');
    return;
  }
  
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('Telegram notification sent');
  } catch (error) {
    console.error('Failed to send Telegram message:', error.message);
  }
}

async function sendEmailNotification(subject, message) {
  if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_USER_ID) {
    console.log('EmailJS credentials not configured');
    return;
  }
  
  try {
    // Note: EmailJS typically works from frontend, but you can use their REST API
    await axios.post('https://api.emailjs.com/api/v1.0/email/send', {
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_USER_ID,
      template_params: {
        subject: subject,
        message: message,
        to_name: 'User',
        from_name: 'AmulProteinStockMonitor'
      }
    });
    console.log('Email notification sent');
  } catch (error) {
    console.error('Failed to send email:', error.message);
  }
}

async function sendNotifications(status, isAvailable, isError = false) {
  const timestamp = new Date().toLocaleString();
  let message, subject;
  
  if (isError) {    subject = '🚨 AmulProteinStockMonitor Error';
    message = `❌ <b>Monitoring Error</b>\n\nThere was an error checking the Amul High Protein Buttermilk availability.\n\nTime: ${timestamp}\nURL: ${URL}`;
  } else if (isAvailable) {
    subject = '✅ Amul Buttermilk Available!';
    message = `🎉 <b>GOOD NEWS!</b>\n\nAmul High Protein Buttermilk is now <b>AVAILABLE</b>!\n\nTime: ${timestamp}\nLink: ${URL}`;
  } else {
    subject = '❌ Amul Buttermilk Out of Stock';
    message = `😔 <b>Status Update</b>\n\nAmul High Protein Buttermilk is currently <b>OUT OF STOCK</b>\n\nTime: ${timestamp}\nWe'll keep monitoring for you!`;
  }
  
  await Promise.all([
    sendTelegramMessage(message),
    sendEmailNotification(subject, message.replace(/<[^>]*>/g, '')) // Remove HTML tags for email
  ]);
}

// Schedule check every 30 minutes
cron.schedule('*/30 * * * *', checkAvailability);

// Initial check
checkAvailability();

console.log('🚀 AmulProteinStockMonitor started!');
console.log('📅 Checking every 30 minutes...');
console.log(`🎯 Monitoring: ${URL}`);

// Keep the process alive
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down monitor...');
  process.exit(0);
});