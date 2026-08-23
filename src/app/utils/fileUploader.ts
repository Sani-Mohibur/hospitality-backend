import multer from 'multer';
import path from 'path';
import streamifier from 'streamifier';
import { v2 as cloudinary } from 'cloudinary';
import config from '../config';
import AppError from '../errors/AppError';

// 1. Cloudinary Configuration
cloudinary.config({
  cloud_name: config.cloudinary.cloud_name!,
  api_key: config.cloudinary.api_key!,
  api_secret: config.cloudinary.api_secret!,
});

// 2. Multer Setup (Memory Storage & Filtering)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = /jpeg|jpg|png|gif|mp4|mov|avi|mkv/;
    const ext = path.extname(file.originalname).toLowerCase();
    const isMimetypeValid =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype === 'text/csv';

    const isExtensionValid = allowedExtensions.test(ext) || ext === '.csv';

    if (isExtensionValid && isMimetypeValid) {
      cb(null, true);
    } else {
      cb(
        new AppError(400, 'Invalid file type. Images, videos, and CSVs only.'),
      );
    }
  },
});

// 3. Cloudinary Upload Logic
const uploadToCloudinary = (
  file: Express.Multer.File,
): Promise<{ url: string; public_id: string }> => {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new AppError(400, 'No file provided'));

    // Determine Resource Type
    const isVideo = file.mimetype.startsWith('video/');
    const isCSV =
      file.originalname.endsWith('.csv') || file.mimetype === 'text/csv';
    const resourceType: 'image' | 'video' | 'raw' = isVideo
      ? 'video'
      : isCSV
        ? 'raw'
        : 'image';

    // Sanitize Filename
    const fileNameOnly = path
      .parse(file.originalname)
      .name.replace(/\s+/g, '_')
      .toLowerCase();
    const safeName = `${Date.now()}-${fileNameOnly}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'uploads',
        resource_type: resourceType,
        public_id: safeName,
        // Only apply transformations to images
        ...(resourceType === 'image' && {
          transformation: [
            {
              width: 800,
              height: 800,
              crop: 'limit',
              quality: 'auto',
              fetch_format: 'auto',
            },
          ],
        }),
      },
      (error, result) => {
        if (error || !result) {
          return reject(
            new AppError(500, error?.message || 'Cloudinary upload failed'),
          );
        }
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
        });
      },
    );

    // Pipe the buffer to Cloudinary
    streamifier.createReadStream(file.buffer).pipe(uploadStream);
  });
};

export const fileUploader = {
  upload,
  uploadToCloudinary,
};
