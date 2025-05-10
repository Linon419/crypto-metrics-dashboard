# Multi-stage build for optimized Docker image

# Stage 1: Build the React frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
COPY postcss.config.js ./
COPY tailwind.config.js ./
RUN npm install
COPY public/ ./public/
COPY src/ ./src/
RUN npm run build

# Stage 2: Set up the Node.js server
FROM node:18-alpine
WORKDIR /app

# Copy backend dependencies and install them
COPY server/package*.json ./
RUN npm install --production

# Copy server files
COPY server/ ./

# Create directory for client build
RUN mkdir -p ./client/build

# Copy built frontend from the previous stage
COPY --from=frontend-builder /app/build ./client/build

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose the port the app runs on
EXPOSE 3001

# Command to run the application
CMD ["node", "index.js"]