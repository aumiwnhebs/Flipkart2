# Flipkart Clone Store - with Auto-Scraping

A Flipkart-like e-commerce store with an admin dashboard that can auto-scrape product details (images, price, MRP, specifications) directly from any Flipkart product URL using Browserless.io.

## Features

- **Auto-Scrape from Flipkart**: Paste any Flipkart product link and instantly get images, MRP, sale price, and specifications
- **Admin Dashboard**: Manage products, UPI payments, and inventory
- **Browserless.io Integration**: No Chrome installation needed - uses remote browser for reliable scraping
- **Mobile Responsive**: Works on all devices

## Railway Deployment

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### Step 2: Deploy on Railway
1. Go to [railway.app](https://railway.app)
2. Sign in and click "New Project"
3. Select "Deploy from GitHub Repo"
4. Choose your repository
5. Railway auto-detects Node.js and deploys

### Step 3: Configure Environment Variables
In Railway dashboard → Settings → Variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `BROWSERLESS_TOKEN` | Your free API token | Get from browserless.io |
| `BROWSERLESS_URL` | `wss://chrome.browserless.io` | Default, no change needed |
| `PORT` | Railway assigns automatically | No need to set |

### Step 4: Get Free Browserless.io Token
1. Go to [browserless.io/signup](https://www.browserless.io/signup?plan=free)
2. Sign up (no credit card required)
3. Copy your API token
4. Paste it as `BROWSERLESS_TOKEN` in Railway

## How Auto-Scraping Works

1. Open `/admin` page
2. Paste a Flipkart product URL
3. Select category and your selling price
4. Click "Fetch Product Details"
5. Browserless.io fetches the rendered page
6. MRP, images, and specs are extracted
7. Preview and edit if needed
8. Click "Save Product to Site"

## Tech Stack

- **Backend**: Node.js + Express.js
- **Frontend**: Vanilla HTML/CSS/JS
- **Scraping**: Browserless.io (remote headless Chrome)
- **Database**: Local JSON files (products.json, upi.json)
- **Image Storage**: Local filesystem

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/products` | GET | Get all products |
| `/api/add-product` | POST | Add product with images |
| `/api/fetch-product-details` | POST | Scrape from Flipkart URL |
| `/api/save-product-auto` | POST | Save scraped product |
| `/api/delete-product` | POST | Delete product |
| `/api/update-upi` | POST | Update UPI ID |
| `/api/config` | GET | Get configuration |

## Local Development

```bash
npm install
npm start
```

Visit: http://localhost:3000/admin

## Environment Variables

Copy `.env.example` to `.env` and fill in your Browserless.io token.
