// server/middleware/auth.js
const jwt = require('jsonwebtoken');

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret-key-change-in-production';

const authMiddleware = (req, res, next) => {
  // Extract token from Authorization header
  const token = req.headers.authorization?.split(' ')[1];
  
  // If no token provided, check if we're in development mode
  if (!token) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('⚠️ No token provided, but proceeding in dev mode');
      req.user = { id: 999, username: 'dev-mode', role: 'admin' };
      return next();
    }
    return res.status(401).json({ error: 'No token provided, authorization denied' });
  }
  
  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Add user info to request
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    
    // In development, allow requests even with invalid tokens
    if (process.env.NODE_ENV !== 'production') {
      console.log('⚠️ Invalid token, but proceeding in dev mode');
      req.user = { id: 999, username: 'dev-mode', role: 'admin' };
      return next();
    }
    
    return res.status(401).json({ error: 'Token is not valid' });
  }
};

module.exports = authMiddleware;