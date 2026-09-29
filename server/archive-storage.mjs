#!/usr/bin/env node
/**
 * The off-edge copy's bucket — RM-148, Stage 4. Run on the edge.
 *
 *     npm run archive:storage              # dry run: does the bucket exist, and what is sealed and copied
 *     npm run archive:storage -- --apply   # create the private bucket if it does not exist
 *
 * Until the bucket exists, every day is still sealed on the edge, but nothing is copied off it, and
 * the janitor prunes nothing from the cloud: its last gate is "copied off the edge".
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { makeStorageClient } from './supabaseStorage.mjs';
import { openArchive } from './archiveDb.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(HERE, '..'));
loadDotEnv(HERE);

const APPLY = process.argv.includes('--apply');
const BUCKET = process.env.ARCHIVE_BUCKET || 'ibems-archive';
const ARCHIVE_PATH = process.env.ARCHIVE_DB_PATH || path.join(HERE, 'data', 'archive', 'archive.sqlite');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env');
  process.exit(2);
}

const storage = makeStorageClient({ url, serviceRoleKey: key });
const bucket = await storage.getBucket(BUCKET);
if (bucket) {
  console.log(`bucket ${BUCKET}: exists, ${bucket.public ? 'PUBLIC — make it private in the dashboard' : 'private'}`);
} else if (APPLY) {
  await storage.createBucket(BUCKET);
  console.log(`bucket ${BUCKET}: created, private`);
} else {
  console.log(`bucket ${BUCKET}: does not exist. Add --apply to create it (private).`);
}

try {
  const archive = openArchive(ARCHIVE_PATH, { readOnly: true });
  const seals = archive.seals();
  const sent = seals.filter((s) => s.uploaded_at);
  const bytes = seals.reduce((a, s) => a + s.bytes, 0);
  console.log(`sealed day-streams: ${seals.length}, copied off the edge: ${sent.length}, ${(bytes / 1e6).toFixed(1)} MB in all ` +
    `(${(bytes / 1e9 * 100).toFixed(1)} % of the Free plan's 1 GB of file storage)`);
  archive.close();
} catch (err) {
  console.log(`archive: not readable here (${String(err.message).split(' — ')[0]})`);
}
