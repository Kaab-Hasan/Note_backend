const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/authMiddleware');
const { 
  hashPassword, 
  comparePassword
} = require('../utils/authUtils');
const {
  handleValidationErrors, 
  passwordChangeValidation
} = require('../utils/validationUtils');
const { body } = require('express-validator');

const prisma = new PrismaClient();

// Get current user profile
router.get('/me', authenticate, async (req, res) => {
  try {
    // Return user data from req.user (set by auth middleware)
    res.json(req.user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user profile (name, email)
router.patch('/me',
  authenticate,
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage('Name must be at least 2 characters'),
    body('email')
      .optional()
      .trim()
      .isEmail()
      .withMessage('Please enter a valid email')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { name, email } = req.body;
      const userId = req.user.id;
      
      // Check if new email already exists
      if (email && email !== req.user.email) {
        const userExists = await prisma.user.findUnique({
          where: { email }
        });
        
        if (userExists) {
          return res.status(400).json({ error: 'Email already in use' });
        }
      }
      
      // Update user data
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(name && { name }),
          ...(email && { email })
        },
        select: {
          id: true,
          name: true,
          email: true
        }
      });
      
      res.json(updatedUser);
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Change password
router.patch('/me/password',
  authenticate,
  passwordChangeValidation,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body;
      const userId = req.user.id;
      
      // Get current user with password
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      
      // Verify old password
      const isPasswordValid = await comparePassword(oldPassword, user.password);
      
      if (!isPasswordValid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      
      // Hash new password
      const hashedPassword = await hashPassword(newPassword);
      
      // Update password
      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      });
      
      res.json({ message: 'Password updated successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router; 