const puppeteer = require('puppeteer');
const config = require('../config');

/**
 * Launch a headless Chromium instance with the render-pipeline's standard options.
 *
 * @param {string[]} extraArgs - additional Chromium flags specific to the caller
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function launchBrowser(extraArgs = []) {
  const browserOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1080,1920',
      ...extraArgs,
    ],
    defaultViewport: { width: 1080, height: 1920 },
  };

  if (config.puppeteerExecutablePath) {
    browserOptions.executablePath = config.puppeteerExecutablePath;
  }

  return puppeteer.launch(browserOptions);
}

module.exports = { launchBrowser };
