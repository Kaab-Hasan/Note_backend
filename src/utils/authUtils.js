const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/**
 * Generate JSON Web Token for user authentication
 * @param {number} userId User ID to encode in the token
 * @returns {string} JWT token
 */
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId }, 
    process.env.JWT_SECRET || 'notes-app-secret', 
    { expiresIn: '30d' }
  );
};

// Hash password
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(12);
  return await bcrypt.hash(password, salt);
};

// Compare password with hash
const comparePassword = async (enteredPassword, hashedPassword) => {
  return await bcrypt.compare(enteredPassword, hashedPassword);
};

/**
 * Set JWT as HTTP-only cookie
 * @param {Object} res Express response object
 * @param {string} token JWT token to set as cookie
 */
const setTokenCookie = (res, token) => {
  const cookieOptions = {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  };
  
  res.cookie('jwt', token, cookieOptions);
};

module.exports = {
  generateToken,
  hashPassword,
  comparePassword,
  setTokenCookie
}; 