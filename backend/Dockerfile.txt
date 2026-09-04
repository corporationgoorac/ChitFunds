# Use Debian Bullseye Slim - The most stable base for Puppeteer
FROM node:18-bullseye-slim

# --- 1. SET SERVER TIME TO IST ---
ENV TZ=Asia/Kolkata
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# --- 2. INSTALL CHROMIUM & CRITICAL SYSTEM LIBRARIES ---
# These specific libraries prevent the "Target closed" crashes in cloud environments
RUN apt-get update \
    && apt-get install -y wget gnupg tzdata \
    && apt-get install -y chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    libxss1 libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# --- 3. CONFIGURE PUPPETEER ---
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# --- 4. HUGGING FACE SECURITY REQUIREMENTS ---
ENV HOME=/home/node
WORKDIR $HOME/app

# Ensure the node user owns the working directory
RUN chown -R node:node $HOME

# Switch to the secure non-root user
USER node

# --- 5. INSTALL APP DEPENDENCIES ---
COPY --chown=node:node package.json package-lock.json* ./
RUN npm install

# --- 6. COPY THE REST OF THE APP ---
COPY --chown=node:node . .

# --- 7. EXPOSE PORT & START ---
EXPOSE 7860
CMD ["node", "server.js"]
