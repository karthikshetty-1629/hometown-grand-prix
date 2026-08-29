FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# storage-data holds the pre-generated world data (road graph, buildings, footpaths) plus
# runtime-written route chunks and ghost runs. Most free/hobby cloud tiers wipe local disk
# on every redeploy or restart — world data ships baked into the image either way, but any
# generated routes/ghosts written after deploy will not survive one. Fine for now; swap
# storage/localStorage.js for the S3/R2 version (see its comments) when that matters.
EXPOSE 3001
CMD ["node", "index.js"]
