const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and body parsing
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure directories exist
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
}

// Multer storage configuration for product images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, imagesDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '.png';
        cb(null, 'image-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

// Serve static assets from myflipkart folder
app.use(express.static(__dirname));

// Serve Admin Dashboard page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// API Endpoint: Get configuration (current UPI, active products count)
app.get('/api/config', (req, res) => {
    let upiId = 'Not Set';
    const upiPath = path.join(__dirname, 'upi.json');
    try {
        if (fs.existsSync(upiPath)) {
            const config = JSON.parse(fs.readFileSync(upiPath, 'utf8'));
            upiId = config.upiId || 'Not Set';
        }
    } catch (e) {
        console.error('Error reading upi.json:', e);
    }

    let productsCount = 0;
    const productsPath = path.join(__dirname, 'products.json');
    try {
        if (fs.existsSync(productsPath)) {
            const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
            productsCount = products.length;
        }
    } catch (e) {}

    res.json({ upiId, productsCount });
});

// API Endpoint: Update UPI ID
app.post('/api/update-upi', (req, res) => {
    const { upiId } = req.body;
    if (!upiId) {
        return res.status(400).json({ error: 'UPI ID is required' });
    }

    const upiPath = path.join(__dirname, 'upi.json');
    try {
        fs.writeFileSync(upiPath, JSON.stringify({ active: true, upiId: upiId.trim() }, null, 2), 'utf8');
        res.json({ success: true, message: 'UPI ID updated successfully' });
    } catch (e) {
        console.error('Error writing upi.json:', e);
        res.status(500).json({ error: 'Failed to save UPI ID' });
    }
});

// API Endpoint: Add new product with multipart form handling
app.post('/api/add-product', upload.array('images', 10), (req, res) => {
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
                // Fallback to comma/newline split
                specsArray = specs.split('\n').map(s => s.trim()).filter(s => s);
            }
        }

        const uploadedImages = req.files.map(file => 'images/' + file.filename);
        const newProduct = {
            id: Date.now(),
            name: name.trim(),
            category: category.trim(),
            price: parsedPrice,
            original_price: parsedOriginalPrice,
            discount: discount,
            image: uploadedImages[0],
            images: uploadedImages,
            specs: specsArray.filter(s => s.trim())
        };

        const productsPath = path.join(__dirname, 'products.json');
        let products = [];
        if (fs.existsSync(productsPath)) {
            const content = fs.readFileSync(productsPath, 'utf8').trim();
            if (content) {
                products = JSON.parse(content);
            }
        }

        products.push(newProduct);
        fs.writeFileSync(productsPath, JSON.stringify(products, null, 4), 'utf8');

        res.json({ success: true, message: 'Product added successfully!', product: newProduct });
    } catch (e) {
        console.error('Error adding product:', e);
        res.status(500).json({ error: 'Server error adding product.' });
    }
});

// API Endpoint: Delete product by ID
app.post('/api/delete-product', (req, res) => {
    const { id } = req.body;
    if (!id) {
        return res.status(400).json({ error: 'Product ID is required.' });
    }

    const productsPath = path.join(__dirname, 'products.json');
    try {
        let products = [];
        if (fs.existsSync(productsPath)) {
            const content = fs.readFileSync(productsPath, 'utf8').trim();
            if (content) {
                products = JSON.parse(content);
            }
        }

        // Find the product image path to delete it from disk
        const targetProduct = products.find(p => p.id == id);
        if (targetProduct) {
            const fileList = targetProduct.images || (targetProduct.image ? [targetProduct.image] : []);
            fileList.forEach(img => {
                const imgPath = path.join(__dirname, img);
                if (fs.existsSync(imgPath)) {
                    fs.unlinkSync(imgPath);
                }
            });
        }

        const filtered = products.filter(p => p.id != id);
        fs.writeFileSync(productsPath, JSON.stringify(filtered, null, 4), 'utf8');
        res.json({ success: true, message: 'Product deleted successfully.' });
    } catch (e) {
        console.error('Error deleting product:', e);
        res.status(500).json({ error: 'Server error deleting product.' });
    }
});

// API Endpoint: Get all products
app.get('/api/products', (req, res) => {
    const productsPath = path.join(__dirname, 'products.json');
    try {
        let products = [];
        if (fs.existsSync(productsPath)) {
            const content = fs.readFileSync(productsPath, 'utf8').trim();
            if (content) {
                products = JSON.parse(content);
            }
        }
        res.json(products);
    } catch (e) {
        res.json([]);
    }
});

// Helper function to download external image URLs from CDN and store locally
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

// API Endpoint: Auto-add product from scraped client data
app.post('/api/add-product-auto', async (req, res) => {
    try {
        const { name, mrp, category, sellingPrice, specs, images } = req.body;
        
        if (!name || !category || !sellingPrice) {
            return res.status(400).json({ error: 'Name, Category, and Target Selling Price are required.' });
        }

        // Download external images locally in the background
        const localImages = [];
        if (images && images.length > 0) {
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
            id: Date.now(),
            name: name.trim(),
            category: category.trim(),
            price: parsedPrice,
            original_price: parsedOriginalPrice,
            discount: discount,
            image: localImages[0] || 'images/default.png',
            images: localImages,
            specs: specs || []
        };

        const productsPath = path.join(__dirname, 'products.json');
        let products = [];
        if (fs.existsSync(productsPath)) {
            const content = fs.readFileSync(productsPath, 'utf8').trim();
            if (content) {
                products = JSON.parse(content);
            }
        }

        products.push(newProduct);
        fs.writeFileSync(productsPath, JSON.stringify(products, null, 4), 'utf8');

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
                waitForTimeout: 5000
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 35000
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
                waitForTimeout: 5000
            },
            {
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
                timeout: 35000,
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
// IMPROVED FLIPKART PRODUCT SCRAPING LOGIC
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
    
    // Method 1: Look for strikethrough price in JSON-LD (most reliable)
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
                            if (offer.priceSpecification) {
                                const specList = Array.isArray(offer.priceSpecification) ? offer.priceSpecification : [offer.priceSpecification];
                                for (const spec of specList) {
                                    if (spec.priceType === 'RegularPrice' || spec.priceType === 'SRP') {
                                        const num = parseInt(String(spec.price).replace(/[^0-9]/g, ''), 10);
                                        if (num > 0 && num > mrp) mrp = num;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) {}
        }
    } catch (e) {}
    
    // Method 2: If JSON-LD didn't give MRP, look for line-through styled text
    if (mrp === 0) {
        // Match text-decoration-line: line-through pattern (mobile layout)
        const lineThroughPatterns = [
            /style="[^"]*text-decoration-line:\s*line-through[^"]*"[^>]*>\s*(?:₹|&#8377;)?\s*([^<]+)/gi,
            /style="[^"]*text-decoration:\s*line-through[^"]*"[^>]*>\s*(?:₹|&#8377;)?\s*([^<]+)/gi,
        ];
        for (const pattern of lineThroughPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const num = parseInt(match[1].replace(/[^0-9]/g, ''), 10);
                if (num > 0 && num > mrp) mrp = num;
            }
        }
    }
    
    // Method 3: Fallback - look for price with strikethrough classes
    if (mrp === 0) {
        const strikethroughPatterns = [
            /class="[^"]*(?:y31Yq2|M5aNdF|y1HkBA)[^"]*"\s*style="[^"]*text-decoration[^"]*"[^>]*>\s*(?:₹|&#8377;)?\s*([^<]+)/gi,
            /class="[^"]*(?:y31Yq2|M5aNdF|y1HkBA)[^"]*"[^>]*>\s*(?:₹|&#8377;)?\s*([^<]+)/gi,
        ];
        for (const pattern of strikethroughPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const num = parseInt(match[1].replace(/[^0-9]/g, ''), 10);
                if (num > 0 && num > mrp) mrp = num;
            }
        }
    }
    
    // Method 4: Broader fallback - any strikethrough/strike class
    if (mrp === 0) {
        const genericPatterns = [
            /class="[^"]*(?:strike|original|_2Tpdn3|_31Qy5e)[^"]*"[^>]*>\s*(?:₹|&#8377;)?\s*([^<]+)/gi,
            /<span[^>]*style="[^"]*text-decoration[^"]*"[^>]*>\s*(?:₹|&#8377;)?\s*([\d,]+)\s*<\/span>/gi,
        ];
        for (const pattern of genericPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const num = parseInt(match[1].replace(/[^0-9]/g, ''), 10);
                if (num > 0 && num > mrp) mrp = num;
            }
        }
    }
    
    // Method 5: Last resort - find any price above the selling price in the page
    if (mrp === 0) {
        const allPriceMatches = html.match(/(?:₹|&#8377;)\s*([\d,]+)/g);
        if (allPriceMatches) {
            const prices = allPriceMatches.map(p => parseInt(p.replace(/[^0-9]/g, ''), 10)).filter(p => p > 0);
            if (prices.length > 1) {
                // MRP is typically the highest price that's crossed out
                // Look for the highest price value on the page
                prices.sort((a, b) => b - a);
                // Find a price that appears near strikethrough styling
                const nearStrike = html.match(new RegExp('(?:₹|&#8377;)\\s*' + prices[0].toLocaleString('en-IN'), 'i'));
                if (nearStrike) mrp = prices[0];
                else if (prices.length > 1) mrp = prices[0];
            }
        }
    }
    
    return mrp;
}

function extractSpecifications(html) {
    const specs = [];
    
    // Method 1: Extract from JSON-LD structured data (product specifications)
    try {
        const ldJsonRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
        let ldMatch;
        while ((ldMatch = ldJsonRegex.exec(html)) !== null) {
            try {
                const data = JSON.parse(ldMatch[1].trim());
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    if (item['@type'] === 'Product') {
                        // Look for product description or additionalProperty
                        if (item.description && item.description.length > 10) {
                            // Description often contains specs in a formatted way
                        }
                        // Look for additionalProperty in structured data
                        if (item.additionalProperty && Array.isArray(item.additionalProperty)) {
                            item.additionalProperty.forEach(prop => {
                                const label = prop.name || prop.propertyName || '';
                                const value = prop.value || '';
                                if (label && value) {
                                    specs.push(`${label}: ${value}`);
                                }
                            });
                        }
                    }
                }
            } catch (e) {}
        }
    } catch (e) {}
    
    // Method 2: Extract from Flipkart's "Specifications" section in HTML
    // Look for spec label-value pairs
    const specLabelPattern = /<div[^>]*class="[^"]*specification[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let specMatch;
    const seenSpecs = new Set();
    while ((specMatch = specLabelPattern.exec(html)) !== null) {
        const innerHtml = specMatch[1];
        // Extract label and value
        const labelMatch = innerHtml.match(/<div[^>]*class="[^"]*(?:specName|_1v1JvX)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        const valueMatch = innerHtml.match(/<div[^>]*class="[^"]*(?:specValue|_341NwK|_1vC4OE)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (labelMatch && valueMatch) {
            const label = labelMatch[1].replace(/<[^>]+>/g, '').trim();
            const value = valueMatch[1].replace(/<[^>]+>/g, '').trim();
            if (label && value && !seenSpecs.has(label)) {
                specs.push(`${label}: ${value}`);
                seenSpecs.add(label);
            }
        }
    }
    
    // Method 3: Extract highlights from the "Highlights" section
    if (specs.length < 3) {
        const highlightPatterns = [
            /<li class="[^"]*(?:_21A10W|_2cM2V8|highlight)[^"]*">([^<]+)<\/li>/gi,
            /<li class="[^"]*">([\s\S]{10,100})<\/li>/gi,
            /<span[^>]*class="[^"]*(?:specHighlight|_1qBb9v)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
        ];
        
        for (const pattern of highlightPatterns) {
            let hMatch;
            let count = 0;
            while ((hMatch = pattern.exec(html)) !== null && count < 10) {
                const text = hMatch[1].replace(/<[^>]+>/g, '').trim();
                if (text.length > 5 && text.length < 120 && !specs.some(s => s.includes(text.substring(0, 15)))) {
                    specs.push(text);
                    count++;
                }
            }
            if (specs.length >= 5) break;
        }
    }
    
    // Method 4: Extract from spec table/grid pattern (common in mobile/electronics)
    if (specs.length < 3) {
        const specRowPattern = /<div[^>]*class="[^"]*(?:spec-row|row)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
        let rowMatch;
        while ((rowMatch = specRowPattern.exec(html)) !== null && specs.length < 10) {
            const rowHtml = rowMatch[1];
            const keyMatch = rowHtml.match(/<div[^>]*>(\s*[A-Z][A-Za-z\s]+\s*)<\/div>/);
            const valMatch = rowHtml.match(/<div[^>]*>([^<]{5,80})<\/div>/g);
            if (keyMatch && valMatch && valMatch.length > 1) {
                const key = keyMatch[1].trim();
                const val = valMatch[1].replace(/<[^>]+>/g, '').trim();
                if (!specs.some(s => s.includes(key))) {
                    specs.push(`${key}: ${val}`);
                }
            }
        }
    }
    
    // Method 5: Extract from common spec key-value patterns in page
    if (specs.length < 2) {
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
                if (val && !specs.some(s => s.includes(key))) {
                    specs.push(`${key}: ${val}`);
                }
            }
        });
    }
    
    // Method 6: Extract from <meta> tags for additional specs
    if (specs.length < 2) {
        const metaSpecs = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^'"]+)["']/i);
        if (metaSpecs) {
            const desc = metaSpecs[1];
            // Split description by commas or pipes to get individual specs
            const descSpecs = desc.split(/[,|]/).map(s => s.trim()).filter(s => s.length > 3 && s.length < 100);
            descSpecs.forEach(s => {
                if (!specs.some(sp => sp.includes(s.substring(0, 10)))) {
                    specs.push(s);
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
                error: 'Failed to fetch page via Browserless. Please check BROWSERLESS_URL and BROWSERLESS_TOKEN environment variables.',
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

// API Endpoint: Save auto-scraped product
app.post('/api/save-product-auto', async (req, res) => {
    try {
        const { name, mrp, category, sellingPrice, specs, images } = req.body;
        
        if (!name || !category || !sellingPrice) {
            return res.status(400).json({ error: 'Name, Category, and Target Selling Price are required.' });
        }

        // Download external images locally
        const localImages = [];
        if (images && images.length > 0) {
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
            id: Date.now(),
            name: name.trim(),
            category: category.trim(),
            price: parsedPrice,
            original_price: parsedOriginalPrice,
            discount: discount,
            image: localImages[0] || 'images/default.png',
            images: localImages,
            specs: specs || []
        };

        const productsPath = path.join(__dirname, 'products.json');
        let products = [];
        if (fs.existsSync(productsPath)) {
            const content = fs.readFileSync(productsPath, 'utf8').trim();
            if (content) {
                products = JSON.parse(content);
            }
        }

        products.push(newProduct);
        fs.writeFileSync(productsPath, JSON.stringify(products, null, 4), 'utf8');

        res.json({ success: true, message: 'Product auto-saved successfully!', product: newProduct });
    } catch (e) {
        console.error('Error saving auto product:', e);
        res.status(500).json({ error: 'Server error during save.' });
    }
});

app.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}...`);
    console.log(`Browserless endpoint: ${BROWSERLESS_URL}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
