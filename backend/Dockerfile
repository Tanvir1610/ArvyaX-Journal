FROM node:20-alpine

WORKDIR /app

# Install only production deps
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY src ./src

# Data volume mount point
RUN mkdir -p /app/data

EXPOSE 5000
CMD ["node", "src/index.js"]
