import { Response } from 'express';

type TResponse<T> = {
    statusCode: number;
    success: boolean;
    message: string;
    meta?: {
        page: number;
        limit: number;
        total: number;
        totalPage: number;
    };
    data?: T;
};

const sendResponse = <T>(res: Response, data: TResponse<T>) => {
    res.status(data.statusCode).json({
        success: data.success,
        message: data.message,
        meta: data.meta,
        data: data.data,
    });
};

export default sendResponse;

// Shorthand used by the route-level handlers of newer modules.
export const ok = <T>(
    res: Response,
    message: string,
    data: T,
    options: { statusCode?: number; meta?: TResponse<T>['meta'] } = {},
) =>
    sendResponse(res, {
        statusCode: options.statusCode || 200,
        success: true,
        message,
        meta: options.meta,
        data,
    });
