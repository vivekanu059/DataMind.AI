import { Router } from 'express';
import { runAnalysis, cleanDataset } from '../controllers/analysisController';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const router = Router();

const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
    },
});

const upload = multer({ storage: multer.memoryStorage() });

const uploadToCloud = async (req: any, res: any, next: any) => {
    if (!req.file) return next();
    const ext = path.extname(req.file.originalname);
    const filename = `datasets/${uuidv4()}${ext}`;
    try {
        await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: filename,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        }));
        req.file.path = `${process.env.S3_PUBLIC_URL}/${filename}`;
        next();
    } catch (error) {
        res.status(500).json({ error: "Cloud upload failed" });
    }
};

router.post('/analyze', upload.single('dataset'), uploadToCloud, runAnalysis);
router.post('/clean', upload.single('dataset'), uploadToCloud, cleanDataset);

router.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(403).send('Invalid filename.');
    }
    // Redirect to the persistent cloud storage
    res.redirect(`${process.env.S3_PUBLIC_URL}/datasets/${filename}`);
});

export default router;