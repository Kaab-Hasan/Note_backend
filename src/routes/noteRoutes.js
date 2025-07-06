const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, checkNoteOwnership } = require('../middleware/authMiddleware');
const { noteValidation, handleValidationErrors } = require('../utils/validationUtils');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Get all notes (metadata only - no content if protected)
router.get('/', authenticate, async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      select: {
        id: true,
        title: true,
        isProtected: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
    
    res.json(notes);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
    console.error('Get notes error:', error);
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new note
router.post('/', 
  authenticate, 
  noteValidation, 
  handleValidationErrors, 
  async (req, res) => {
    try {
      let { title, description, isProtected, password } = req.body;
      const userId = req.user.id;
      
      // Hash password if note is protected
      if (isProtected && password) {
        password = await bcrypt.hash(password, 12);
      }
      
      // Create note in transaction with initial version
      const note = await prisma.$transaction(async (prisma) => {
        // Create note
        const newNote = await prisma.note.create({
          data: {
            title,
            description,
            isProtected: isProtected || false,
            password,
            ownerId: userId
          }
        });
        
        // Create initial version
        await prisma.noteVersion.create({
          data: {
            title: newNote.title,
            description: newNote.description,
            noteId: newNote.id
          }
        });
        
        return newNote;
      });
      
      // Emit socket event for real-time notification
      try {
        const io = req.app.get('io');
        io.emit('notification', {
          action: 'create',
          noteId: note.id,
          userId,
          title: note.title,
          timestamp: new Date()
        });
      } catch (socketError) {
        console.error('Socket error:', socketError);
      }
      
      res.status(201).json(note);
    } catch (error) {
      console.error('Create note error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Get note by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    const userId = req.user.id;
    
    const note = await prisma.note.findUnique({
      where: { id: noteId },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    // If note is protected, and current user is NOT the owner, don't return content
    if (note.isProtected && note.owner.id !== userId) {
      return res.json({
        ...note,
        description: null,
        needsPassword: true,
        password: undefined
      });
    }
    
    res.json({
      ...note,
      password: undefined
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
    console.error('Get note error:', error);
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Unlock protected note
router.post('/:id/unlock', authenticate, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    const note = await prisma.note.findUnique({
      where: { id: noteId }
    });
    
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    if (!note.isProtected) {
      return res.status(400).json({ error: 'This note is not protected' });
    }
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, note.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    // Return note with content if password is valid
    res.json({
      ...note,
      password: undefined
    });
  } catch (error) {
    console.error('Unlock note error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update note
router.patch('/:id', 
  authenticate, 
  checkNoteOwnership, 
  noteValidation, 
  handleValidationErrors, 
  async (req, res) => {
    try {
      const noteId = parseInt(req.params.id);
      if (isNaN(noteId)) {
        return res.status(400).json({ error: 'Invalid note ID. Must be a number.' });
      }
      
      let { title, description, isProtected, password } = req.body;
      const userId = req.user.id;
      
      // Get current note
      const currentNote = await prisma.note.findUnique({
        where: { id: noteId }
      });
      
      if (!currentNote) {
        return res.status(404).json({ error: 'Note not found' });
      }
      
      // Validate protection status and password
      if (isProtected && !password && !currentNote.isProtected) {
        return res.status(400).json({ error: 'Password is required when protecting a note' });
      }
      
      // Hash password if provided
      if (isProtected && password) {
        password = await bcrypt.hash(password, 12);
      }
      
      // Prepare update data - don't change password if it's empty and note is already protected
      const updateData = {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(isProtected !== undefined && { isProtected }),
        ...(password ? { password } : {})
      };
      
      // Update note in transaction with version history
      const updatedNote = await prisma.$transaction(async (prisma) => {
        // Save current version first
        await prisma.noteVersion.create({
          data: {
            title: currentNote.title,
            description: currentNote.description,
            noteId: currentNote.id
          }
        });
        
        // Update note
        return prisma.note.update({
          where: { id: noteId },
          data: updateData
        });
      });
      
      // Emit socket event for real-time notification
      try {
        const io = req.app.get('io');
        io.emit('notification', {
          action: 'update',
          noteId: updatedNote.id,
          userId,
          title: updatedNote.title,
          timestamp: new Date()
        });
      } catch (socketError) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Socket error:', socketError);
        }
      }
      
      res.json({
        ...updatedNote,
        password: undefined
      });
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Update note error:', error);
      }
      res.status(500).json({ error: 'Server error updating note' });
    }
  }
);

// Delete note
router.delete('/:id', authenticate, checkNoteOwnership, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    if (isNaN(noteId)) {
      return res.status(400).json({ error: 'Invalid note ID. Must be a number.' });
    }
    
    const userId = req.user.id;
    
    // Check if note exists
    const noteExists = await prisma.note.findUnique({
      where: { id: noteId },
      select: { id: true, title: true }
    });
    
    if (!noteExists) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    // Delete note (versions will cascade delete)
    const deletedNote = await prisma.note.delete({
      where: { id: noteId }
    });
    
    // Emit socket event for real-time notification
    try {
      const io = req.app.get('io');
      io.emit('notification', {
        action: 'delete',
        noteId: deletedNote.id,
        userId,
        title: deletedNote.title,
        timestamp: new Date()
      });
    } catch (socketError) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Socket error:', socketError);
      }
    }
    
    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Delete note error:', error);
    }
    res.status(500).json({ error: 'Server error deleting note' });
  }
});

// Get note versions
router.get('/:id/versions', authenticate, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    
    const note = await prisma.note.findUnique({
      where: { id: noteId },
      select: { 
        id: true,
        title: true, 
        description: true,
        isProtected: true, 
        ownerId: true,
        createdAt: true,
        updatedAt: true
      }
    });
    
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    // If note is protected and user is not the owner, check if unlocked first
    if (note.isProtected && note.ownerId !== req.user.id) {
      return res.status(403).json({ 
        error: 'Access denied - Unlock protected note first' 
      });
    }
    
    // Get all versions
    const versions = await prisma.noteVersion.findMany({
      where: { noteId },
      orderBy: { createdAt: 'desc' }
    });
    
    // Create a current version from the note itself
    const currentVersion = {
      id: 'current',
      title: note.title,
      description: note.description,
      noteId: note.id,
      createdAt: note.updatedAt, // Use the note's updated timestamp
      isCurrent: true
    };
    
    // Add current version at the beginning of the array
    const allVersions = [currentVersion, ...versions];
    
    res.json(allVersions);
  } catch (error) {
    console.error('Get versions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Revert to specific version
router.post('/:id/revert', authenticate, checkNoteOwnership, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    const versionId = req.body.versionId;
    const userId = req.user.id;
    
    // Parse the version ID if it's a number
    const parsedVersionId = isNaN(parseInt(versionId)) ? versionId : parseInt(versionId);
    
    // Get version to revert to
    const version = await prisma.noteVersion.findUnique({
      where: { id: parsedVersionId }
    });
    
    if (!version || version.noteId !== noteId) {
      return res.status(404).json({ error: 'Version not found' });
    }
    
    // Get current note
    const currentNote = await prisma.note.findUnique({
      where: { id: noteId }
    });
    
    // Update note in transaction with version history
    const revertedNote = await prisma.$transaction(async (prisma) => {
      // Save current state as version first
      await prisma.noteVersion.create({
        data: {
          title: currentNote.title,
          description: currentNote.description,
          noteId: currentNote.id
        }
      });
      
      // Revert to selected version
      return prisma.note.update({
        where: { id: noteId },
        data: {
          title: version.title,
          description: version.description
        }
      });
    });
    
    // Emit socket event for real-time notification
    try {
      const io = req.app.get('io');
      io.emit('notification', {
        action: 'revert',
        noteId: revertedNote.id,
        userId,
        title: revertedNote.title,
        timestamp: new Date(),
        versionId: parsedVersionId
      });
    } catch (socketError) {
      console.error('Socket error:', socketError);
    }
    
    res.json({
      ...revertedNote,
      password: undefined
    });
  } catch (error) {
    console.error('Revert note error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; 