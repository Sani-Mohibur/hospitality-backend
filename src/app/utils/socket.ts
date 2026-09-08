import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import config from '../config';
import logger from './logger';

class SocketManager {
  private static instance: SocketManager;
  private io: Server | null = null;

  private constructor() {}

  public static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  public init(server: HttpServer): void {
    this.io = new Server(server, {
      cors: {
        origin: config.urls.frontend || 'http://localhost:3000',
        credentials: true,
      },
    });

    this.io.on('connection', (socket: Socket) => {
      logger.info(`Socket connected: ${socket.id}`);

      // Client can join a specific room (e.g., their tenantId or userId)
      socket.on('joinRoom', (room: string) => {
        socket.join(room);
        logger.info(`Socket ${socket.id} joined room ${room}`);
      });

      socket.on('leaveRoom', (room: string) => {
        socket.leave(room);
        logger.info(`Socket ${socket.id} left room ${room}`);
      });

      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
      });
    });
    
    logger.info('Socket.io initialized successfully');
  }

  public emitToRoom(room: string, event: string, data: any): void {
    if (this.io) {
      this.io.to(room).emit(event, data);
    } else {
      logger.error('Socket.io is not initialized');
    }
  }

  public emitToAll(event: string, data: any): void {
    if (this.io) {
      this.io.emit(event, data);
    } else {
      logger.error('Socket.io is not initialized');
    }
  }
}

export const socketManager = SocketManager.getInstance();
