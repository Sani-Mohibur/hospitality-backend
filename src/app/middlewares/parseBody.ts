import { NextFunction, Request, Response } from 'express';
import AppError from '../errors/AppError';

export const parseBody = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body.data) {
        return next(new AppError(400, 'Please provide data in the "data" field'));
    }

    try {
        req.body = JSON.parse(req.body.data);
        next();
    } catch (error) {
        next(new AppError(400, 'Invalid JSON format in data field'));
    }
};