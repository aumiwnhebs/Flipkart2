const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and body parsing
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================
// MONGODB CONNECTION (HARDCODED)
// ============================================================
const MONGODB_URI = 'mongodb+srv://rxprime0002_db_user:fImjYrVSrGpkWL8f@cluster0.7j2ih6n.mongodb.net/myflipkart?appName=Cluster0';
const DB_NAME = 'myflipkart';
let db;
let client;

async function connectMongo() {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connected to MongoDB: ' + DB_NAME);
    
    // Ensure collections exist with indexes
    await db.collection('products').createIndex({ id: 1 }, { unique: true });
    await db.collection('upi').createIndex({ key: 1 }, { unique: true });
    
    // Initialize UPI document if not exists
    const upiDoc = await db.collection('upi').findOne({ key: 'upiId' });
    if (!upiDoc) {
        await db.collection('upi').insertOne({ key: 'upiId', upiId: 'Not Set' });
    }
}

// ============================================================
// HELPER: Generate unique ID
// ============================================================
function generateId() {
    return Date.now() + Math.floor(Math.random() * 1000);
}

// ============================================================
// API Endpoint: Get configuration (current UPI, active products count)
// ============================================================
app.get('/api/config', async (req, res) => {
    try {
        const upiDoc = await db.collection('upi').findOne({ key: 'upiId' });
        const productsCount = await db.collection('products').countDocuments();
        
        res.json({ 
            upiId: upiDoc?.upiId || 'Not Set', 
            productsCount 
        });
    } catch (e) {
        console.error('Error getting config:', e);
        res.status(500).json({ error: 'Database error' });
    }
});

// ============================================================
// API Endpoint: Update UPI ID
// ============================================================
app.post('/api/update-upi', async (req, res) => {
    const { upiId } = req.body;
    if (!upiId) {
        return res.status(400).json({ error: 'UPI ID is required' });
    }

    try {
        await db.collection('upi').updateOne(
            { key: 'upiId' },
            { $set: { upiId: upiId.trim() } },
            { upsert: true }
        );
        res.json({ success: true, message: 'UPI ID updated successfully' });
    } catch (e) {
        console.error('Error updating UPI:', e);
        res.status(500).json({ error: 'Failed to save UPI ID' });
    }
});

// ============================================================
// API Endpoint: Get all products
// ============================================================
app.get('/api/products', async (req, res) => {
    try {
        const products = await db.collection('products').find({}).sort({ id: -1 }).toArray();
        res.json(products);
    } catch (e) {
        console.error('Error fetching products:', e);
        res.json([]);
    }
});

// ============================================================
// Multer storage configuration for product images
// ============================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const imagesDir = path.join(__dirname, 'images');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }
        cb(null, imagesDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '.png';
        cb(null, 'image-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

// ============================================================
// API Endpoint: Add new product with multipart form handling
// ============================================================
app.post('/api/add-product', upload.array('images', 10), async (req, res) => {
    try {
        const { name, category, price, original_price, specs } = req.body;
        
        if (!name || !category || !price) {
            return res.status(400).json({ error: 'Name, Category, and Price are required fields.' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'At least one product image file is required.' });
        }

        let parsedPrice = parseInt(price.replace(/[^0-9]/g, ''), 10);
        let parsedOriginalPrice = original_price ? parseInt(original_price.replace(/[^0-9]/g, ''), 10) : parsedPrice;

        if (isNaN(parsedPrice)) {
            return res.status(400).json({ error: 'Invalid selling price numeric format.' });
        }

        // Apply same auto-swap rule: MRP should be higher than Selling Price
        if (parsedOriginalPrice < parsedPrice) {
            const temp = parsedPrice;
            parsedPrice = parsedOriginalPrice;
            parsedOriginalPrice = temp;
        }

        // Calculate discount
        const pDiff = parsedOriginalPrice - parsedPrice;
        const discount = parsedOriginalPrice > 0 ? Math.round((pDiff / parsedOriginalPrice) * 100) : 0;

        // Parse specifications
        let specsArray = [];
        if (specs) {
            try {
                specsArray = JSON.parse(specs);
            } catch (e) {
                specsArray = specs.split('\n').map(s => s.trim()).filter(s => s);
            }
        }

        const uploadedImages = req.files.map(file => 'images/' + file.filename);
        const newProduct = {
            id: generateId(),
            name: name.trim(),
            category: category.trim(),
            price: parsedPrice,
            original_price: parsedOriginalPrice,
            discount: discount,
            image: uploadedImages[0],
            images: uploadedImages,
            specs: specsArray.filter(s => s.trim()),
            createdAt: new Date()
        };

        await db.collection('products').insertOne(newProduct);

        res.json({ success: true, message: 'Product added successfully!', product: newProduct });
    } catch (e) {
        console.error('Error adding product:', e);
        res.status(500).json({ error: 'Server error adding product.' });
    }
});

// ============================================================
// API Endpoint: Delete product by ID
// ============================================================
app.post('/api/delete-product', async (req, res) => {
    const { id } = req.body;
    if (!id) {
        return res.status(400).json({ error: 'Product ID is required.' });
    }

    try {
        // Find the product to get image paths
        const targetProduct = await db.collection('products').findOne({ id: Number(id) || String(id) });
        if (targetProduct) {
            // Delete local image files if they exist
            const fileList = targetProduct.images || (targetProduct.image ? [targetProduct.image] : []);
            fileList.forEach(img => {
                const imgPath = path.join(__dirname, img);
                if (fs.existsSync(imgPath)) {
                    fs.unlinkSync(imgPath);
                }
            });
        }

        // Delete from MongoDB
        await db.collection('products').deleteOne({ id: Number(id) || String(id) });
        
        res.json({ success: true, message: 'Product deleted successfully.' });
    } catch (e) {
        console.error('Error deleting product:', e);
        res.status(500).json({ error: 'Server error deleting product.' });
    }
});

// ============================================================
// Helper function to download external image URLs
// ============================================================
function downloadExternalImage(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const protocol = url.startsWith('https') ? require('https') : require('http');
        protocol.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download image: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

// ============================================================
// API Endpoint: Save auto-scraped product
// ============================================================
app.post('/api/add-product-auto', async (req, res) => {
    try {
        const { name, mrp, category, sellingPrice, specs, images } = req.body;
        
        if (!name || !category || !sellingPrice) {
            return res.status(400).json({ error: 'Name, Category, and Target Selling Price are required.' });
        }

        // Download external images locally
        const localImages = [];
        if (images && images.length > 0) {
            const imagesDir = path.join(__dirname, 'images');
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
            for (let i = 0; i < images.length; i++) {
                const ext = path.extname(images[i].split('?')[0]) || '.png';
                const filename = `auto-${Date.now()}-${i}${ext}`;
                const destPath = path.join(imagesDir, filename);
                try {
                    await downloadExternalImage(images[i], destPath);
                    localImages.push('images/' + filename);
                } catch (err) {
                    console.error(`Failed to download image ${i}:`, err);
                }
            }
        }

        let parsedPrice = parseInt(String(sellingPrice).replace(/[^0-9]/g, ''), 10);
        let parsedOriginalPrice = mrp ? parseInt(String(mrp).replace(/[^0-9]/g, ''), 10) : parsedPrice;

        if (isNaN(parsedPrice)) {
            return res.status(400).json({ error: 'Invalid selling price numeric format.' });
        }

        // Apply auto-swap rule: MRP should be higher than Selling Price
        if (parsedOriginalPrice < parsedPrice) {
            const temp = parsedPrice;
            parsedPrice = parsedOriginalPrice;
            parsedOriginalPrice = temp;
        }

        // Calculate discount
        const pDiff = parsedOriginalPrice - parsedPrice;
        const discount = parsedOriginalPrice > 0 ? Math.round((pDiff / parsedOriginalPrice) * 100) : 0;

        const newProduct = {
            id: generateId(),
            name: name.trim(),
            category: category.trim(),
            price: parsedPrice,
            original_price: parsedOriginalPrice,
            discount: discount,
            image: localImages[0] || 'images/default.png',
            images: localImages,
            specs: specs || [],
            createdAt: new Date()
        };

        await db.collection('products').insertOne(newProduct);

        res.json({ success: true, message: 'Product auto-ingested successfully!', product: newProduct });
    } catch (e) {
        console.error('Error auto-ingesting product:', e);
        res.status(500).json({ error: 'Server error during auto-ingestion.' });
    }
});

// ============================================================
// BROWSERLESS.IO INTEGRATION - Flipkart Product Scraping
// ============================================================

const BROWSERLESS_HOST = 'https://production-sfo.browserless.io';
const BROWSERLESS_TOKEN = '2UrB1VJgb4xcfyf0f74fc8b1672cfca0a1acd4e4899050b00';

async function fetchWithBrowserless(url) {
    console.log(`Fetching page via Browserless: ${url}`);
    
    // Try /unblock first (best for anti-bot sites like Flipkart)
    try {
        const unblockResponse = await axios.post(
            `${BROWSERLESS_HOST}/unblock?token=${BROWSERLESS_TOKEN}&proxy=residential`,
            {
                url: url,
                content: true,
                cookies: false,
                screenshot: false,
                browserWSEndpoint: false,
                waitForTimeout: 10000
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 40000
            }
        );
        console.log(`Browserless /unblock returned ${unblockResponse.data.content ? unblockResponse.data.content.length : 0} bytes`);
        return unblockResponse.data.content || '';
    } catch (unblockError) {
        console.log(`Browserless /unblock failed, trying /content: ${unblockError.message}`);
    }
    
    // Fallback to /content endpoint
    try {
        const contentResponse = await axios.post(
            `${BROWSERLESS_HOST}/content?token=${BROWSERLESS_TOKEN}`,
            {
                url: url,
                waitForTimeout: 10000
            },
            {
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
                timeout: 40000,
                responseType: 'text'
            }
        );
        console.log(`Browserless /content returned ${contentResponse.data.length} bytes`);
        return contentResponse.data;
    } catch (contentError) {
        console.error(`Browserless /content also failed: ${contentError.message}`);
        throw new Error(`Browserless fetch failed via both endpoints: ${contentError.message}`);
    }
}

// ============================================================
// FLIPKART PRODUCT SCRAPING LOGIC
// ============================================================

function extractProductName(html) {
    let name = '';
    
    // Method 1: From <title> tag
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
        name = titleMatch[1].trim()
            .replace(/\s*Online\s+at\s+Best\s+Price.*$/i, '')
            .replace(/\s*-\s*Buy\s+.*$/i, '')
            .replace(/\s*-\s*Portronics\s*:.*$/i, '')
            .replace(/\s*:\s*Flipkart\.com.*$/i, '')
            .replace(/\s*-?\s*Buy\s+Online\s+.*$/i, '')
            .trim();
    }
    
    // Method 2: From OG title meta tag
    if (!name || name.length < 5) {
        const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^'"]+)["']/i);
        if (ogTitle) {
            name = ogTitle[1].trim().replace(/\s*-\s*Flipkart\.com.*$/i, '').trim();
        }
    }
    
    // Method 3: From h1 with class matching Flipkart product title pattern
    if (!name || name.length < 5) {
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match) {
            const cleanName = h1Match[1].replace(/<[^>]+>/g, '').trim();
            if (cleanName.length > 5) {
                name = cleanName;
            }
        }
    }
    
    if (!name || name.length < 3) name = "Auto Ingested Product";
    return name;
}

function extractMRP(html) {
    let mrp = 0;
    
    // Step 1: Find the SELLING PRICE (current price) from JSON-LD
    let sellingPrice = 0;
    let sellingPriceIndex = -1;
    try {
        const ldJsonRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
        let ldMatch;
        while ((ldMatch = ldJsonRegex.exec(html)) !== null) {
            try {
                const data = JSON.parse(ldMatch[1].trim());
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    if (item['@type'] === 'Product' && item.offers) {
                        const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
                        for (const offer of offers) {
                            if (offer.price) {
                                const sp = parseInt(String(offer.price).replace(/[^0-9]/g, ''), 10);
                                if (sp > 0 && sp > sellingPrice) {
                                    sellingPrice = sp;
                                    // Find position of this price in the HTML - search from start of page
                                    const priceFormatted = '₹' + sp.toLocaleString('en-IN');
                                    let idx = html.indexOf(priceFormatted);
                                    if (idx === -1) {
                                        // Also try the raw number without comma
                                        idx = html.indexOf(String(sp));
                                    }
                                    if (idx > 0) sellingPriceIndex = idx;
                                }
                            }
                        }
                    }
                }
            } catch (e) {}
        }
    } catch (e) {}
    
    // If JSON-LD didn't give position, find selling price in top section of page
    if (sellingPriceIndex === -1 && sellingPrice > 0) {
        const titleIdx = html.indexOf('<title>');
        const searchArea = html.substring(0, Math.min(html.length, titleIdx + 100000));
        const priceFormatted = '₹' + sellingPrice.toLocaleString('en-IN');
        const idx = searchArea.indexOf(priceFormatted);
        if (idx > 0) sellingPriceIndex = idx;
        else {
            // Last resort: just search from start of page
            const idx2 = html.indexOf(priceFormatted);
            if (idx2 > 0) sellingPriceIndex = idx2;
        }
    }
    
    // Step 2: PROXIMITY-BASED MRP - Find strikethrough price VERY CLOSE to selling price
    // The real MRP on Flipkart is always shown RIGHT NEXT to the selling price
    // We look within 3000 chars of the selling price to avoid related product prices
    if (sellingPrice > 0 && sellingPriceIndex > 0) {
        const searchStart = Math.max(0, sellingPriceIndex - 3000);
        const searchEnd = Math.min(html.length, sellingPriceIndex + 3000);
        const nearArea = html.substring(searchStart, searchEnd);
        
        // Find strikethrough prices in this area only
        const nearbyStrikethroughs = [];
        
        // Pattern 1: text-decoration-line: line-through
        const stPattern = /text-decoration-line:\s*line-through[^>]*>\s*(?:₹|&#8377;)?\s*([\d,]+)/gi;
        let stMatch;
        while ((stMatch = stPattern.exec(nearArea)) !== null) {
            const num = parseInt(stMatch[1].replace(/[^0-9]/g, ''), 10);
            if (num > 0 && num > sellingPrice) {
                nearbyStrikethroughs.push(num);
            }
        }
        
        // Pattern 2: text-decoration: line-through (older format)
        const stPattern2 = /text-decoration:\s*line-through[^>]*>\s*(?:₹|&#8377;)?\s*([\d,]+)/gi;
        while ((stMatch = stPattern2.exec(nearArea)) !== null) {
            const num = parseInt(stMatch[1].replace(/[^0-9]/g, ''), 10);
            if (num > 0 && num > sellingPrice && !nearbyStrikethroughs.includes(num)) {
                nearbyStrikethroughs.push(num);
            }
        }
        
        // Pattern 3: Generic strikethrough classes
        const stPattern3 = /class="[^"]*(?:y31Yq2|M5aNdF|y1HkBA|strike|original)[^"]*"[^>]*>\s*(?:₹|&#8377;)?\s*([\d,]+)/gi;
        while ((stMatch = stPattern3.exec(nearArea)) !== null) {
            const num = parseInt(stMatch[1].replace(/[^0-9]/g, ''), 10);
            if (num > 0 && num > sellingPrice && !nearbyStrikethroughs.includes(num)) {
                nearbyStrikethroughs.push(num);
            }
        }
        
        if (nearbyStrikethroughs.length > 0) {
            // Pick the HIGHEST strikethrough price near selling price
            nearbyStrikethroughs.sort((a, b) => b - a);
            mrp = nearbyStrikethroughs[0];
        }
    }
    
    // Step 3: If proximity search failed, try broader strikethrough scan
    if (mrp === 0) {
        const allStrikethroughs = [];
        const stPattern = /text-decoration-line:\s*line-through[^>]*>\s*(?:₹|&#8377;)?\s*([\d,]+)/gi;
        let stMatch;
        while ((stMatch = stPattern.exec(html)) !== null) {
            const num = parseInt(stMatch[1].replace(/[^0-9]/g, ''), 10);
            if (num > 0 && num > sellingPrice) {
                allStrikethroughs.push({ price: num, index: stMatch.index });
            }
        }
        
        const stPattern2 = /text-decoration:\s*line-through[^>]*>\s*(?:₹|&#8377;)?\s*([\d,]+)/gi;
        while ((stMatch = stPattern2.exec(html)) !== null) {
            const num = parseInt(stMatch[1].replace(/[^0-9]/g, ''), 10);
            if (num > 0 && num > sellingPrice) {
                allStrikethroughs.push({ price: num, index: stMatch.index });
            }
        }
        
        // Sort by distance from selling price, pick closest
        if (allStrikethroughs.length > 0) {
            allStrikethroughs.sort((a, b) => 
                Math.abs(a.index - sellingPriceIndex) - Math.abs(b.index - sellingPriceIndex)
            );
            mrp = allStrikethroughs[0].price;
        }
    }
    
    // Step 4: If still no MRP, try JSON-LD listPrice
    if (mrp === 0) {
        try {
            const ldJsonRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
            let ldMatch;
            while ((ldMatch = ldJsonRegex.exec(html)) !== null) {
                try {
                    const data = JSON.parse(ldMatch[1].trim());
                    const items = Array.isArray(data) ? data : [data];
                    for (const item of items) {
                        if (item['@type'] === 'Product' && item.offers) {
                            const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
                            for (const offer of offers) {
                                if (offer.listPrice || offer.highPrice) {
                                    const mrpVal = offer.listPrice || offer.highPrice;
                                    const num = parseInt(String(mrpVal).replace(/[^0-9]/g, ''), 10);
                                    if (num > 0 && num > mrp) mrp = num;
                                }
                            }
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }
    
    return mrp;
}

function extractSpecifications(html) {
    const specs = [];
    const seen = new Set();
    
    // Method 1: Extract specs from JSON-LD Product description (MOST RELIABLE for highlights)
    try {
        const ldJsonRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
        let ldMatch;
        while ((ldMatch = ldJsonRegex.exec(html)) !== null) {
            try {
                const data = JSON.parse(ldMatch[1].trim());
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    if (item['@type'] === 'Product') {
                        // Parse "include X, Y, Z" pattern from description
                        if (item.description && item.description.length > 10) {
                            const desc = item.description;
                            const includeMatch = desc.match(/include\s+(.+?)(?:\.|Compare|\s{2})/i);
                            if (includeMatch) {
                                const specsText = includeMatch[1];
                                const parts = specsText.split(/,\s*|\s+and\s+/);
                                for (const part of parts) {
                                    const trimmed = part.trim();
                                    if (trimmed.length > 5 && trimmed.length < 120 && !seen.has(trimmed)) {
                                        specs.push(trimmed);
                                        seen.add(trimmed);
                                    }
                                }
                            }
                            // Also extract individual spec phrases
                            const specPhrases = desc.match(/\d+\s*(?:GB|MB|mAh|MP|inch|inches|Hz|W)\s*[A-Za-z]+(?:\s+[a-z]+)?/g);
                            if (specPhrases) {
                                for (const phrase of specPhrases) {
                                    const trimmed = phrase.trim();
                                    if (trimmed.length > 5 && !seen.has(trimmed)) {
                                        specs.push(trimmed);
                                        seen.add(trimmed);
                                    }
                                }
                            }
                        }
                        // Extract brand, color from Product
                        if (item.brand && item.brand.name && !seen.has(`Brand: ${item.brand.name}`)) {
                            specs.push(`Brand: ${item.brand.name}`);
                            seen.add(`Brand: ${item.brand.name}`);
                        }
                        if (item.color && !seen.has(`Color: ${item.color}`)) {
                            specs.push(`Color: ${item.color}`);
                            seen.add(`Color: ${item.color}`);
                        }
                        // Extract rating
                        if (item.aggregateRating) {
                            const rating = `Rating: ${item.aggregateRating.ratingValue} / 5 (${item.aggregateRating.ratingCount || item.aggregateRating.reviewCount || ''} reviews)`;
                            if (!seen.has(rating)) {
                                specs.push(rating);
                                seen.add(rating);
                            }
                        }
                        // Also check for additionalProperty
                        if (item.additionalProperty && Array.isArray(item.additionalProperty)) {
                            item.additionalProperty.forEach(prop => {
                                const label = prop.name || prop.propertyName || '';
                                const value = prop.value || '';
                                if (label && value) {
                                    const specStr = `${label}: ${value}`;
                                    if (!seen.has(specStr)) {
                                        specs.push(specStr);
                                        seen.add(specStr);
                                    }
                                }
                            });
                        }
                    }
                }
            } catch (e) {}
        }
    } catch (e) {}
    
    // Method 2: Extract from Flipkart's rendered "Specifications" section in HTML
    const specLabelPattern = /<div[^>]*class="[^"]*specification[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let specMatch;
    while ((specMatch = specLabelPattern.exec(html)) !== null) {
        const innerHtml = specMatch[1];
        const labelMatch = innerHtml.match(/<div[^>]*class="[^"]*(?:specName|_1v1JvX)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        const valueMatch = innerHtml.match(/<div[^>]*class="[^"]*(?:specValue|_341NwK|_1vC4OE)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (labelMatch && valueMatch) {
            const label = labelMatch[1].replace(/<[^>]+>/g, '').trim();
            const value = valueMatch[1].replace(/<[^>]+>/g, '').trim();
            if (label && value && !seen.has(label)) {
                specs.push(`${label}: ${value}`);
                seen.add(label);
            }
        }
    }
    
    // Method 3: Extract from rendered "Key Highlights" section
    if (specs.length < 6) {
        const khIdx = html.indexOf('Key Highlights');
        if (khIdx > 0) {
            const section = html.substring(khIdx, khIdx + 3000);
            const textItems = section.match(/>([A-Za-z][A-Za-z0-9\.\s\+\-,\/\(\)]{5,80})</g);
            if (textItems) {
                for (const item of textItems) {
                    const clean = item.slice(1, -1).trim();
                    if (clean && clean !== 'Key Highlights' && clean.length > 5 && !seen.has(clean)) {
                        specs.push(clean);
                        seen.add(clean);
                    }
                }
            }
        }
    }
    
    // Method 4: Extract from spec table/grid pattern
    if (specs.length < 4) {
        const specRowPattern = /<div[^>]*class="[^"]*(?:spec-row|row)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
        let rowMatch;
        while ((rowMatch = specRowPattern.exec(html)) !== null && specs.length < 10) {
            const rowHtml = rowMatch[1];
            const keyMatch = rowHtml.match(/<div[^>]*>(\s*[A-Z][A-Za-z\s]+\s*)<\/div>/);
            const valMatch = rowHtml.match(/<div[^>]*>([^<]{5,80})<\/div>/g);
            if (keyMatch && valMatch && valMatch.length > 1) {
                const key = keyMatch[1].trim();
                const val = valMatch[1].replace(/<[^>]+>/g, '').trim();
                if (!seen.has(key)) {
                    specs.push(`${key}: ${val}`);
                    seen.add(key);
                }
            }
        }
    }
    
    // Method 5: Extract from common spec key-value patterns in page
    if (specs.length < 4) {
        const commonKeys = [
            "Display Size", "Screen Size", "Resolution", "Processor",
            "RAM", "Internal Storage", "ROM", "Battery", "Battery Capacity",
            "Camera", "Primary Camera", "Front Camera", "Secondary Camera",
            "Brand", "Color", "Weight", "Network", "SIM"
        ];
        
        commonKeys.forEach(key => {
            const pattern = new RegExp(
                `<div[^>]*>\s*${key.replace(/ /g, '\\s*')}\s*</div>\\s*<div[^>]*>\s*([^<]+)\\s*</div>`,
                'i'
            );
            const match = html.match(pattern);
            if (match) {
                const val = match[1].replace(/<[^>]+>/g, '').trim();
                if (val && !seen.has(key)) {
                    specs.push(`${key}: ${val}`);
                    seen.add(key);
                }
            }
        });
    }
    
    // Method 6: Extract from <meta> tags for additional specs
    if (specs.length < 3) {
        const metaSpecs = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^'"]+)["']/i);
        if (metaSpecs) {
            const desc = metaSpecs[1];
            const descSpecs = desc.split(/[,|]/).map(s => s.trim()).filter(s => s.length > 3 && s.length < 100);
            descSpecs.forEach(s => {
                if (!seen.has(s)) {
                    specs.push(s);
                    seen.add(s);
                }
            });
        }
    }
    
    return specs;
}

function extractImages(html) {
    let images = [];
    
    // Method 1: Extract from JSON-LD Schema.org metadata (most reliable for high-res)
    try {
        const ldJsonRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
        let ldMatch;
        while ((ldMatch = ldJsonRegex.exec(html)) !== null) {
            try {
                const data = JSON.parse(ldMatch[1].trim());
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    if (item['@type'] === 'Product' && item.image) {
                        const imgList = Array.isArray(item.image) ? item.image : [item.image];
                        imgList.forEach(img => {
                            const highRes = img.replace(/\/image\/\d+\/\d+\//, '/image/832/832/')
                                               .replace(/\/image\/\d+\/\d+\//, '/image/832/832/')
                                               .replace('rukmini1.flixcart.com', 'rukminim2.flixcart.com')
                                               .split('?')[0];
                            if (!images.includes(highRes) && highRes.includes('rukminim') && images.length < 8) {
                                images.push(highRes);
                            }
                        });
                    }
                }
            } catch (e) {}
        }
    } catch (e) {}
    
    // Method 2: Extract from og:image meta tags
    if (images.length < 2) {
        const ogImageRegex = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^'"]+)["']/gi;
        let ogMatch;
        while ((ogMatch = ogImageRegex.exec(html)) !== null) {
            let img = ogMatch[1];
            if (img.startsWith('//')) img = 'https:' + img;
            img = img.replace(/\/image\/\d+\/\d+\//, '/image/832/832/').split('?')[0];
            if (!images.includes(img) && images.length < 8) {
                images.push(img);
            }
        }
    }
    
    // Method 3: Fallback - extract from CDN URLs in HTML
    if (images.length === 0) {
        const imgRegex = /https:\/\/rukminim2\.flixcart\.com\/image\/\d+\/\d+\/([a-z0-9\-]+)\/[a-z0-9\-]+\/[a-z0-9\/_\.\-\?]+/gi;
        let match;
        const categoryCounts = {};
        const tempImages = [];
        imgRegex.lastIndex = 0;
        while ((match = imgRegex.exec(html)) !== null) {
            const fullUrl = match[0];
            const categoryFolder = match[1];
            if (fullUrl.includes('-original-') || fullUrl.includes('-enriched-')) {
                const highRes = fullUrl.replace(/\/image\/\d+\/\d+\//, '/image/832/832/').split('?')[0];
                if (!highRes.includes('placeholder') && !highRes.includes('logo')) {
                    tempImages.push({ url: highRes, cat: categoryFolder });
                    categoryCounts[categoryFolder] = (categoryCounts[categoryFolder] || 0) + 1;
                }
            }
        }
        let mainCategory = '';
        let maxCount = 0;
        for (const cat in categoryCounts) {
            if (categoryCounts[cat] > maxCount) {
                maxCount = categoryCounts[cat];
                mainCategory = cat;
            }
        }
        tempImages.forEach(item => {
            if (item.cat === mainCategory && !images.includes(item.url) && images.length < 8) {
                images.push(item.url);
            }
        });
    }
    
    return images;
}

// ============================================================
// API ENDPOINT: Fetch Product Details via Browserless.io
// ============================================================
app.post('/api/fetch-product-details', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required.' });
    }

    try {
        console.log(`Step 1: Scraping details for URL: ${url}`);
        
        // Fetch rendered HTML via Browserless.io
        let html = '';
        try {
            html = await fetchWithBrowserless(url);
            console.log(`Browserless returned ${html.length} bytes of HTML`);
        } catch (browserlessError) {
            console.error('Browserless fetch failed:', browserlessError.message);
            return res.status(500).json({ 
                error: 'Failed to fetch page via Browserless. Please check the token.',
                details: browserlessError.message
            });
        }

        // Extract all data from rendered HTML
        const name = extractProductName(html);
        const mrp = extractMRP(html);
        const specs = extractSpecifications(html);
        const images = extractImages(html);

        console.log(`Scraped details: name: "${name}", MRP: ₹${mrp}, Images: ${images.length}, Specs: ${specs.length}`);
        
        res.json({
            success: true,
            name,
            mrp,
            specs,
            images
        });
    } catch (e) {
        console.error('Error during scraping:', e);
        res.status(500).json({ error: 'Server error during scraping.' });
    }
});

// ============================================================
// API Endpoint: Save auto-scraped product
// ============================================================
app.post('/api/save-product-auto', async (req, res) => {
    try {
        const { name, mrp, category, sellingPrice, specs, images } = req.body;
        
        if (!name || !category || !sellingPrice) {
            return res.status(400).json({ error: 'Name, Category, and Target Selling Price are required.' });
        }

        // Download external images locally
        const localImages = [];
        if (images && images.length > 0) {
            const imagesDir = path.join(__dirname, 'images');
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
            for (let i = 0; i < images.length; i++) {
                const ext = path.extname(images[i].split('?')[0]) || '.png';
                const filename = `auto-${Date.now()}-${i}${ext}`;
                const destPath = path.join(imagesDir, filename);
                try {
                    await downloadExternalImage(images[i], destPath);
                    localImages.push('images/' + filename);
                } catch (err) {
                    console.error(`Failed to download image ${i}:`, err);
                }
            }
        }

        let parsedPrice = parseInt(String(sellingPrice).replace(/[^0-9]/g, ''), 10);
        let parsedOriginalPrice = mrp ? parseInt(String(mrp).replace(/[^0-9]/g, ''), 10) : parsedPrice;

        if (isNaN(parsedPrice)) {
            return res.status(400).json({ error: 'Invalid selling price numeric format.' });
        }

        // Apply auto-swap rule: MRP should be higher than Selling Price
        if (parsedOriginalPrice < parsedPrice) {
            const temp = parsedPrice;
            parsedPrice = parsedOriginalPrice;
            parsedOriginalPrice = temp;
        }

        // Calculate discount
        const pDiff = parsedOriginalPrice - parsedPrice;
        const discount = parsedOriginalPrice > 0 ? Math.round((pDiff / parsedOriginalPrice) * 100) : 0;

        const newProduct = {
            id: generateId(),
            name: name.trim(),
            category: category.trim(),
            price: parsedPrice,
            original_price: parsedOriginalPrice,
            discount: discount,
            image: localImages[0] || 'images/default.png',
            images: localImages,
            specs: specs || [],
            createdAt: new Date()
        };

        await db.collection('products').insertOne(newProduct);

        res.json({ success: true, message: 'Product auto-saved successfully!', product: newProduct });
    } catch (e) {
        console.error('Error saving auto product:', e);
        res.status(500).json({ error: 'Server error during save.' });
    }
});

// ============================================================
// SERVE STATIC FILES (index.html, admin.html, images)
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.use('/images', express.static(path.join(__dirname, 'images')));

// ============================================================
// START SERVER WITH MONGODB CONNECTION
// ============================================================
connectMongo().then(() => {
    app.listen(PORT, () => {
        console.log(`Express server running on port ${PORT}...`);
        console.log(`Browserless endpoint: ${BROWSERLESS_HOST}`);
        console.log(`Admin panel: http://localhost:${PORT}/admin`);
        console.log(`Database: ${DB_NAME} (MongoDB Atlas)`);
    });
}).catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err.message);
    console.error('Check connection string and network access.');
    process.exit(1);
});
