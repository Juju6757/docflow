import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // API health route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", socketsConnected: io.sockets.sockets.size });
  });

  // Store in-memory state of active rooms for conflict resolution and tracking
  // room id -> { version: number, content: string, title: string, collaborators: Map<socketId, { user: any, cursor: { start: number, end: number } | null }> }
  const docRooms = new Map<string, {
    version: number;
    content: string;
    title: string;
    collaborators: Map<string, { user: any; cursor: { start: number; end: number } | null }>;
  }>();

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("join-document", ({ docId, user, currentContent, currentTitle }) => {
      socket.join(docId);
      console.log(`User ${user?.id} (${user?.email}) joined document ${docId}`);

      if (!docRooms.has(docId)) {
        docRooms.set(docId, {
          version: 1,
          content: currentContent || "",
          title: currentTitle || "Untitled Document",
          collaborators: new Map()
        });
      }

      const room = docRooms.get(docId)!;
      room.collaborators.set(socket.id, { user, cursor: null });

      // Broadcast collaborators update
      const activeCollaborators = Array.from(room.collaborators.entries()).map(([id, item]) => ({
        socketId: id,
        user: item.user,
        cursor: item.cursor
      }));
      io.to(docId).emit("collaborators-updated", activeCollaborators);

      // Sent latest server state to the newly joined client
      socket.emit("document-init", {
        content: room.content,
        title: room.title,
        version: room.version
      });
    });

    socket.on("edit-document", ({ docId, content, title, version, authorId }) => {
      const room = docRooms.get(docId);
      if (!room) return;

      // Conflict Resolution / Last-Write-Wins update:
      // If client provides a newer or equal version, or we simply update to resolve conflict.
      // We will increment the server version and store content
      room.version = (room.version || 0) + 1;
      if (content !== undefined) room.content = content;
      if (title !== undefined) room.title = title;

      // Broadcast the update to EVERYONE ELSE in the room
      socket.to(docId).emit("document-updated", {
        content: room.content,
        title: room.title,
        version: room.version,
        senderId: socket.id,
        authorId
      });
    });

    socket.on("cursor-move", ({ docId, cursor }) => {
      const room = docRooms.get(docId);
      if (!room) return;

      const collab = room.collaborators.get(socket.id);
      if (collab) {
        collab.cursor = cursor; // { start, end }
        // Broadcast cursor update to other users in the doc
        socket.to(docId).emit("cursor-updated", {
          socketId: socket.id,
          userId: collab.user?.id,
          user: collab.user,
          cursor
        });
      }
    });

    socket.on("disconnecting", () => {
      // Find which rooms this socket was in
      for (const docId of socket.rooms) {
        if (docId === socket.id) continue;
        const room = docRooms.get(docId);
        if (room) {
          room.collaborators.delete(socket.id);
          const activeCollaborators = Array.from(room.collaborators.entries()).map(([id, item]) => ({
            socketId: id,
            user: item.user,
            cursor: item.cursor
          }));
          io.to(docId).emit("collaborators-updated", activeCollaborators);
          
          if (room.collaborators.size === 0) {
            // Cleanup empty room memory after 1 minute if unused
            setTimeout(() => {
              const r = docRooms.get(docId);
              if (r && r.collaborators.size === 0) {
                docRooms.delete(docId);
              }
            }, 60000);
          }
        }
      }
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-stack server with Socket.IO running on port ${PORT}`);
  });
}

startServer();
