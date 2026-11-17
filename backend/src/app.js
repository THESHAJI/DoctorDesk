const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');

const app = express();

// ========================
// SECURITY MIDDLEWARE
// ========================
// Helmet sets secure HTTP headers
app.use(helmet());

// ========================
// CORS CONFIGURATION
// ========================
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL
    : 'http://localhost:5173', // Vite default port
  credentials: true, // Allow cookies to be sent
}));

// ========================
// BODY PARSING
// ========================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ========================
// COOKIE PARSER
// ========================
app.use(cookieParser());

// ========================
// CSRF DEFENSE-IN-DEPTH
// ========================
// Require Content-Type: application/json on all state-changing requests
// (POST/PUT/DELETE/PATCH). This blocks simple HTML form CSRF attacks.
const { requireJsonContentType } = require('./middleware/csrf.middleware');
app.use(requireJsonContentType);

// ========================
// REQUEST LOGGING
// ========================
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ========================
// API ROUTES
// ========================
app.use('/api', routes);

// ========================
// ERROR HANDLING
// ========================
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
