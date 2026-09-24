import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import config from '../config';
import logger from './logger';

type TSocketUser = {
  id: string;
  tenantId?: string;
  role: string;
  allLocations: boolean;
  locationIds: string[];
  permissions: string[];
};

// Verifies the handshake token and whether a user may join a room. Injected at
// startup to keep this file free of model imports (avoids import cycles).
export type TSocketAuthorizer = {
  authenticate: (token: string) => Promise<TSocketUser>;
  canJoin: (user: TSocketUser, room: string) => Promise<boolean>;
  defaultRooms: (user: TSocketUser) => string[];
};

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

  public init(server: HttpServer, authorizer: TSocketAuthorizer): void {
    this.io = new Server(server, {
      cors: {
        origin: config.urls.frontend || 'http://localhost:3000',
        credentials: true,
      },
    });

    this.io.use(async (socket, next) => {
      try {
        const token =
          (socket.handshake.auth && socket.handshake.auth.token) ||
          String(socket.handshake.headers.authorization || '').replace(/^Bearer /, '');
        if (!token) return next(new Error('Unauthorized'));
        socket.data.user = await authorizer.authenticate(token);
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const user = socket.data.user as TSocketUser;
      for (const room of authorizer.defaultRooms(user)) socket.join(room);
      logger.debug(`Socket connected: ${socket.id} user ${user.id}`);

      socket.on('joinRoom', async (room: string, ack?: (res: { ok: boolean; error?: string }) => void) => {
        try {
          if (typeof room !== 'string' || !(await authorizer.canJoin(user, room))) {
            ack?.({ ok: false, error: 'Not allowed to join this room' });
            return;
          }
          socket.join(room);
          ack?.({ ok: true });
        } catch {
          ack?.({ ok: false, error: 'Join failed' });
        }
      });

      socket.on('leaveRoom', (room: string) => {
        socket.leave(room);
      });

      socket.on('disconnect', () => {
        logger.debug(`Socket disconnected: ${socket.id}`);
      });
    });

    logger.info('Socket.io initialized successfully');
  }

  public emitToRoom(room: string, event: string, data: any): void {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }

  public emitToAll(event: string, data: any): void {
    if (this.io) {
      this.io.emit(event, data);
    }
  }
}

export const socketManager = SocketManager.getInstance();
