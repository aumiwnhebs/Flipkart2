const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
// Enable CORS and body parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
            const content = fs.readFileSync(productsPath, 'utf8').strip || fs.readFileSync(productsPath, 'utf8').trim();
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


const { execFile } = require('child_process');

// Find Google Chrome executable path
// Find Chromium executable path in Linux / Railway
// Find Chromium executable path
function getChromePath() {
    const paths = [
        "/nix/var/nix/profiles/default/bin/chromium",
        "/root/.nix-profile/bin/chromium",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome-stable"
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return 'chromium';
}

// Scraper with VPS Flags (--no-sandbox, --disable-gpu)
app.post('/api/fetch-product-details', (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required.' });
    }

    const chromePath = getChromePath();

    const args = [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-setuid-sandbox',
        '--virtual-time-budget=10000',
        '--dump-dom',
        url
    ];

    execFile(chromePath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
            console.error('Scraper Error:', error);
            return res.status(500).json({ error: 'Failed to retrieve page contents.' });
        }

        const html = stdout;

        // Extract Name
        let name = '';
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) {
            name = titleMatch[1].trim()
                .replace(/\s*Online\s+at\s+Best\s+Price.*$/i, '')
                .replace(/\s*-\s*Buy\s+.*$/i, '')
                .replace(/\s*:\s*Flipkart\.com.*$/i, '')
                .trim();
        }
        if (!name) name = "Auto Ingested Product";

        // Extract MRP
        let mrp = 0;
        const lineThroughMatch = html.match(/style="[^"]*text-decoration(?:-line)?:\\s*line-through[^"]*"[^>]*>\\s*(?:₹|&#8377;)?\\s*([^<]+)<\/div>/i);
        if (lineThroughMatch) {
            mrp = parseInt(lineThroughMatch[1].replace(/[^0-9]/g, ''), 10) || 0;
        }

        // Extract Images
        let images = [];
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
                            const highRes = img.replace('/image/1500/1500/', '/image/832/832/').split('?')[0];
                            if (!images.includes(highRes) && images.length < 8) {
                                images.push(highRes);
                            }
                        });
                    }
                }
            } catch (e) {}
        }

        res.json({ success: true, name, mrp, specs: [], images });
    });
});

app.post('/api/fetch-product-details', (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required.' });
    }

    const chromePath = getChromePath();
    if (!chromePath) {
        return res.status(500).json({ error: 'Google Chrome installation not found on server.' });
    }

    console.log(`Step 1: Scraping details for URL: ${url}`);
    
    // Execute Chrome with virtual time budget (10s) to allow lazy-loaded elements to load
    execFile(chromePath, [
    '--headless=new', 
    '--disable-gpu', 
    '--no-sandbox', 
    '--disable-setuid-sandbox', 
    '--disable-dev-shm-usage',
    '--virtual-time-budget=20000', 
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', 
    '--dump-dom', 
    url
], { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
        if (error) {
            console.error('Chrome execution error:', error);
            return res.status(500).json({ error: 'Failed to retrieve page contents.' });
        }

        const html = stdout;

        // 1. Parse Product Name/Title
        let name = '';
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) {
            name = titleMatch[1].trim()
                .replace(/\s*Online\s+at\s+Best\s+Price.*$/i, '')
                .replace(/\s*-\s*Buy\s+.*$/i, '')
                .replace(/\s*-\s*Portronics\s*:.*$/i, '')
                .replace(/\s*:\s*Flipkart\.com.*$/i, '')
                .trim();
        }
        if (!name) name = "Auto Ingested Product";

        // 2. Parse MRP (Original Price)
        let mrp = 0;
        
        // Scan for elements styled with line-through (standard mobile layout original pricing indicator)
        const lineThroughMatch = html.match(new RegExp('style="[^"]*text-decoration-line:\\s*line-through[^"]*"[^>]*>\\s*(?:₹|&#8377;)?\\s*([^<]+)</div>', 'i')) ||
                                 html.match(new RegExp('style="[^"]*text-decoration:\\s*line-through[^"]*"[^>]*>\\s*(?:₹|&#8377;)?\\s*([^<]+)</div>', 'i'));
        if (lineThroughMatch) {
            mrp = parseInt(lineThroughMatch[1].replace(/[^0-9]/g, ''), 10) || 0;
        }
        
        // Fallback standard desktop classes matches
        if (mrp === 0) {
            const mrpMatches = html.match(new RegExp('class="[^"]*(?:y31Yq2|M5aNdF)[^"]*">\\s*(?:₹|&#8377;)?\\s*([^<]+)', 'i'));
            if (mrpMatches) {
                mrp = parseInt(mrpMatches[1].replace(/[^0-9]/g, ''), 10) || 0;
            }
        }
        if (mrp === 0) {
            const genericMrpMatch = html.match(new RegExp('class="[^"]*(?:strike|original)[^"]*">\\s*(?:₹|&#8377;)?\\s*([^<]+)', 'i'));
            if (genericMrpMatch) {
                mrp = parseInt(genericMrpMatch[1].replace(/[^0-9]/g, ''), 10) || 0;
            }
        }

        // 3. Parse Highlights/Specifications
        const specs = [];
        
        // Mobile layout sibling divisions parser
        const keysToExtract = ["Internal Storage", "RAM", "Primary Camera", "Secondary Camera", "Battery Capacity", "Processor Brand", "Processor Type", "Display Size"];
        keysToExtract.forEach(key => {
            const pattern = new RegExp('<div[^>]*>\\s*' + key.replace(/ /g, '\\s*') + '\\s*</div>\\s*<div[^>]*>\\s*([^<]+)\\s*</div>', 'i');
            const match = html.match(pattern);
            if (match) {
                const val = match[1].trim();
                specs.push(`${key}: ${val}`);
            }
        });
        
        // Fallback to desktop highlights list parser if sibling specs is empty
        if (specs.length === 0) {
            const highlightRegex = /<li class="[^"]*(?:_21A10W|_2cM2V8)[^"]*">([^<]+)<\/li>/gi;
            let hMatch;
            while ((hMatch = highlightRegex.exec(html)) !== null) {
                specs.push(hMatch[1].trim());
            }
        }
        if (specs.length === 0) {
            const genericLiRegex = /<li class="[^"]*">([^<]{10,80})<\/li>/gi;
            let genMatch;
            let count = 0;
            while ((genMatch = genericLiRegex.exec(html)) !== null && count < 8) {
                const text = genMatch[1].trim();
                if (!text.includes('<') && !text.includes('>') && text.length > 5) {
                    specs.push(text);
                    count++;
                }
            }
        }

        // 4. Parse Images (Extract high-res swipable main product photos from Schema.org JSON-LD metadata block)
        let images = [];
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
                            const highRes = img.replace('/image/1500/1500/', '/image/832/832/')
                                               .replace('/image/300/300/', '/image/832/832/')
                                               .replace('rukmini1.flixcart.com', 'rukminim2.flixcart.com')
                                               .split('?')[0];
                            if (!images.includes(highRes) && images.length < 8) {
                                images.push(highRes);
                            }
                        });
                    }
                }
            } catch (e) {
                // Ignore parsing errors for other script blocks
            }
        }
        
        // Fallback: If JSON-LD does not exist, use previous category frequency-based matching logic
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

        console.log(`Scraped details for preview: name: "${name}", MRP: ₹${mrp}, Images found: ${images.length}, Specs found: ${specs.length}`);
        
        res.json({
            success: true,
            name,
            mrp,
            specs,
            images
        });
    });
});

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
});
