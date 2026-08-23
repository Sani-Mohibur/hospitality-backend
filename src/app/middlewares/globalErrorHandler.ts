import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import config from '../config';
import { TErrorSources } from '../interfaces/error.interface';
import handleZodError from '../errors/handleZodError';
import handleValidationError from '../errors/handleValidationError';
import handleCastError from '../errors/handleCastError';
import handleDuplicateError from '../errors/handleDuplicateError';
import AppError from '../errors/AppError';

const globalErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
    // console.error the full error object for better debugging in development
    if (config.env === 'development') {
        console.error('Global Error Handler:', err);
    }

    //setting default values
    let statusCode = 500;
    let message = 'Something went wrong!';
    let errorSources: TErrorSources = [
        {
            path: '',
            message: 'Something went wrong',
        },
    ];

    const assignSimplifiedError = (simplifiedError: any) => {
        if (simplifiedError) {
            statusCode = simplifiedError.statusCode;
            message = simplifiedError.message;
            errorSources = simplifiedError.errorSources;
        }
    };

    if (err instanceof ZodError) {
        assignSimplifiedError(handleZodError(err));
    } else if (err?.name === 'ValidationError') {
        assignSimplifiedError(handleValidationError(err));
    } else if (err?.name === 'CastError') {
        assignSimplifiedError(handleCastError(err));
    } else if (err?.code === 11000) {
        assignSimplifiedError(handleDuplicateError(err));
    } else if (err instanceof AppError) {
        statusCode = err?.statusCode;
        message = err.message;
        errorSources = [
            {
                path: '',
                message: err?.message,
            },
        ];
    } else if (err instanceof Error) {
        message = err.message;
        errorSources = [
            {
                path: '',
                message: err?.message,
            },
        ];
    }

    //ultimate return
    return res.status(statusCode).json({
        success: false,
        message,
        errorSources,
        stack: config.env === 'development' ? err?.stack : null,
    });
};

export default globalErrorHandler;