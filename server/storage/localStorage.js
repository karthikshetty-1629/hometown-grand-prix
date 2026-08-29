// ============================================================
// STORAGE ADAPTER — LOCAL FILESYSTEM (MVP / TESTING ONLY)
// ============================================================
// TODO (future): replace the body of these functions with S3/R2
// calls using the AWS SDK or Cloudflare R2's S3-compatible API.
// Keep the function signatures identical so nothing else in the
// codebase needs to change when you switch.
//
// Rule: every route file imports ONLY this module — never `fs`
// directly. This is the one seam that changes when storage moves
// to the cloud.
// ============================================================

const fs = require('fs').promises;
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', 'storage-data');

async function saveFile(category, filename, dataBuffer) {
  const dir = path.join(BASE_DIR, category);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, dataBuffer);
  return filePath;

  // --- FUTURE S3 VERSION ---
  // const s3 = new S3Client({ region: 'auto', endpoint: R2_ENDPOINT, credentials: {...} });
  // await s3.send(new PutObjectCommand({
  //   Bucket: 'hometown-gp',
  //   Key: `${category}/${filename}`,
  //   Body: dataBuffer,
  // }));
}

async function readFile(category, filename) {
  const filePath = path.join(BASE_DIR, category, filename);
  return fs.readFile(filePath);

  // --- FUTURE S3 VERSION ---
  // const s3 = new S3Client({ ... });
  // const result = await s3.send(new GetObjectCommand({ Bucket: 'hometown-gp', Key: `${category}/${filename}` }));
  // return streamToBuffer(result.Body);
}

async function listFiles(category) {
  const dir = path.join(BASE_DIR, category);
  await fs.mkdir(dir, { recursive: true });
  return fs.readdir(dir);

  // --- FUTURE S3 VERSION ---
  // list objects with a prefix using ListObjectsV2Command
}

module.exports = { saveFile, readFile, listFiles };
