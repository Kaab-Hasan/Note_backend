require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const noteRoutes = require('./routes/noteRoutes');

// Import seed function
const seedDatabase = require('./utils/seedData');

// Initialize Express app
const app = express();
const httpServer = createServer(app);

// Frontend URL for CORS (use environment variable if available, otherwise fallback to hardcoded)
const FRONTEND_URL = process.env.FRONTEND_URL || "https://note-frontend-jet.vercel.app";

let prisma;
try {
  prisma = new PrismaClient();
} catch (error) {
  console.error('Failed to initialize Prisma Client:', error);
  process.exit(1);
}

const io = new Server(httpServer, {
  cors: {
    origin: ["https://note-frontend-jet.vercel.app/"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({ 
  origin: ["https://note-frontend-jet.vercel.app/"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());
app.use(cookieParser());

// Make io available to route handlers
app.set('io', io);

// Set up Socket.IO
io.on('connection', (socket) => {
  // Only log in development mode
  if (process.env.NODE_ENV !== 'production') {
    console.log('User connected:', socket.id);
  }

  socket.on('noteChange', (data) => {
    // Broadcast to all users
    io.emit('notification', {
      ...data,
      timestamp: new Date()
    });
  });

  socket.on('disconnect', () => {
    // Only log in development mode
    if (process.env.NODE_ENV !== 'production') {
      console.log('User disconnected:', socket.id);
    }
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notes', noteRoutes);

// Serve static files from frontend build
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// SPA Fallback (for React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// Start server
const PORT = process.env.PORT || 5000;

// Function to seed the database if needed
const seedIfNeeded = async () => {
  if (process.env.SEED_DATABASE === 'true') {
    if (process.env.NODE_ENV !== 'production') {
      console.log('Seeding flag detected, initializing database with sample data...');
    }
    
    try {
      // Run the seed function
      const result = await seedDatabase();
      
      if (process.env.NODE_ENV !== 'production' && result) {
        console.log(`Database seeded successfully! Created ${result.usersCount} users and ${result.notesCount} notes.`);
      }
    } catch (error) {
      console.error('Error seeding database:', error);
      // Continue even if seeding fails
    }
  }
};

// Initialize server
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Attempt to seed after server starts (optional)
  if (process.env.SEED_DATABASE === 'true') {
    seedIfNeeded().catch(err => {
      console.error('Failed to seed database:', err);
    });
  }
});

module.exports = { app, io, prisma }; 
