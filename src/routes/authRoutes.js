const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { 
  hashPassword, 
  comparePassword, 
  generateToken, 
  setTokenCookie 
} = require('../utils/authUtils');
const { 
  registerValidation, 
  loginValidation, 
  handleValidationErrors 
} = require('../utils/validationUtils');

const prisma = new PrismaClient();

// Register user
router.post('/register', 
  registerValidation, 
  handleValidationErrors, 
  async (req, res) => {
    try {
      const { name, email, password } = req.body;

      // Check if user already exists
      const userExists = await prisma.user.findUnique({
        where: { email }
      });

      if (userExists) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Create user with hashed password
      const hashedPassword = await hashPassword(password);
      
      const user = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword
        },
        select: {
          id: true,
          name: true,
          email: true
        }
      });

      // Generate JWT token
      const token = generateToken(user.id);
      
      // Set cookie with JWT token
      setTokenCookie(res, token);

      res.status(201).json({
        id: user.id,
        name: user.name,
        email: user.email
      });
    } catch (error) {
      console.error('Register error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Login user
router.post('/login', 
  loginValidation, 
  handleValidationErrors, 
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email }
      });

      // Check if user exists and password is correct
      if (!user || !(await comparePassword(password, user.password))) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Generate JWT token
      const token = generateToken(user.id);
      
      // Set cookie with JWT token
      setTokenCookie(res, token);

      res.json({
        id: user.id,
        name: user.name,
        email: user.email
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Logout user
router.post('/logout', (req, res) => {
  // Clear JWT cookie
  res.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0),
  });
  res.json({ message: 'Logged out successfully' });
});

module.exports = router; 