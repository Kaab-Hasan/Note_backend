const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Authenticate token middleware
const authenticate = async (req, res, next) => {
  try {
    // Get token from cookie or authorization header
    let token = req.cookies?.jwt;
    
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided' });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'notes-app-secret');
    
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    // Set user on request object
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Check note ownership middleware
const checkNoteOwnership = async (req, res, next) => {
  try {
    const noteId = parseInt(req.params.id);
    const userId = req.user.id;
    
    // Find note
    const note = await prisma.note.findUnique({
      where: { id: noteId },
      select: { ownerId: true }
    });
    
    // Note not found
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    // Not the owner
    if (note.ownerId !== userId) {
      return res.status(403).json({ error: 'Access denied. You are not the owner of this note' });
    }
    
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { authenticate, checkNoteOwnership }; 