import { io } from 'socket.io-client';

// Single shared socket instance prevents duplicate event streams across React renders.
const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:4200', {
  autoConnect: true
});

export default socket;
