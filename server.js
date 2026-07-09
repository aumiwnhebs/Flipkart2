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

// Serve static assets from root folder
app.use(express.static(__dirname));

// Default home route
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('Server is running!');
    }
});

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

        if (parsedOriginalPrice < parsedPrice) {
            const temp = parsedPrice;
            parsedPrice = parsedOriginalPrice;
            parsedOriginalPrice = temp;
        }

        const pDiff = parsedOriginalPrice - parsedPrice;
        const discount = parsedOriginalPrice > 0 ? Math.round((pDiff / parsedOriginalPrice) * 100) : 0;

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

// Helper function to download external image URLs
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

        if (parsedOriginalPrice < parsedPrice) {
            const temp = parsedPrice;
            parsedPrice = parsedOriginalPrice;
            parsedOriginalPrice = temp;
        }

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

// Scraper Endpoint
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

        let mrp = 0;
        const lineThroughMatch = html.match(/style="[^"]*text-decoration(?:-line)?:\\s*line-through[^"]*"[^>]*>\\s*(?:₹|&#8377;)?\\s*([^<]+)<\/div>/i);
        if (lineThroughMatch) {
            mrp = parseInt(lineThroughMatch[1].replace(/[^0-9]/g, ''), 10) || 0;
        }

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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express server running on port ${PORT}...`);
});
