import { Router } from 'express';
import { runAnalysis } from '../controllers/analysisController';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { cleanDataset } from '../controllers/analysisController';

const router = Router();
const upload = multer({ dest: 'uploads/' });

// POST route for the frontend to hit
router.post('/analyze', runAnalysis);

router.post('/clean', upload.single('dataset'), cleanDataset);

// 2. The Download endpoint
// 🛡️ Add this new Download route
router.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    
    // Security check to prevent directory traversal
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(403).send('Invalid filename.');
    }

    // Locate the file in the backend's 'uploads' directory
    const filePath = path.join(process.cwd(), 'uploads', filename);
    
    if (fs.existsSync(filePath)) {
        // Send the file as an attachment to trigger the browser download
        res.download(filePath, filename);
    } else {
        res.status(404).send('File not found on server.');
    }
});

export default router;