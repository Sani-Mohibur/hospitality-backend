import { v2 as cloudinary } from 'cloudinary';
import AppError from '../errors/AppError';
import httpStatus from 'http-status';

const deleteFromCloudinary = async (
  publicId: string,
  resourceType: 'image' | 'video' = 'image',
) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });

    if (result.result !== 'ok' && result.result !== 'not_found') {
      throw new Error(result.result);
    }

    return result;
  } catch (error: any) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Cloudinary Deletion Failed: ${error.message}`,
    );
  }
};

export const fileDeleter = {
  deleteFromCloudinary,
};
