# Use the official Bun image
FROM oven/bun:1

# Install system dependencies required for Lighthouse and the scripts
# chromium: Browser for Lighthouse
# jq: JSON processor used in scripts
# bc: Calculator used in scripts
# procps: Standard process utilities
RUN apt-get update && apt-get install -y \
    chromium \
    jq \
    bc \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install Lighthouse CLI globally using Bun
RUN bun add -g lighthouse

# Create a symlink for node so the lighthouse binary (which has #!/usr/bin/env node) works using Bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/node

# Set environment variable for Chrome path so Lighthouse can find it
ENV CHROME_PATH=/usr/bin/chromium

# Set the working directory
WORKDIR /app

# Copy the shell scripts
COPY lighthouse-throttle.sh lighthouse-run-all.sh lighthouse-diff.sh ./

# Make scripts executable
RUN chmod +x *.sh

# Copy the frontend files
COPY frontend ./frontend

# Copy the server files
COPY server ./server

# Install server dependencies
WORKDIR /app/server
RUN bun install

# Expose the port the server listens on
EXPOSE 8080

# Start the server
CMD ["bun", "run", "index.ts"]
