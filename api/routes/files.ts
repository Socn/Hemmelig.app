import { zValidator } from '@hono/zod-validator';
import { createReadStream, createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import prisma from '../lib/db';
import {
    decodeUploadFilenameHeader,
    generateSafeFilePath,
    getMaxFileSize,
    getUploadSizeFromHeaders,
    isPathSafe,
} from '../lib/files';
import { resolveSettings } from '../lib/settings';
import { authMiddleware } from '../middlewares/auth';
import { idParamSchema } from '../validations/shared';

const files = new Hono();

async function removePartialUpload(path: string): Promise<void> {
    try {
        await unlink(path);
    } catch {
        // Best-effort cleanup; the original upload error is more useful to report.
    }
}

async function writeUploadStream(
    streamToWrite: NodeJS.ReadableStream,
    path: string
): Promise<void> {
    try {
        await pipeline(streamToWrite, createWriteStream(path));
    } catch (error) {
        await removePartialUpload(path);
        throw error;
    }
}

files.get('/:id', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');

    try {
        // Fetch file with its associated secrets to verify access
        const file = await prisma.file.findUnique({
            where: { id },
            include: {
                secrets: {
                    select: {
                        id: true,
                        views: true,
                        expiresAt: true,
                    },
                },
            },
        });

        if (!file) {
            return c.json({ error: 'File not found' }, 404);
        }

        // Security: Verify the file is associated with at least one valid (non-expired) secret
        // This prevents direct file access without going through the secret viewing flow
        // We allow views >= 0 because files need to be downloadable after the last view is consumed
        // (the secret view and file download are separate requests)
        const hasValidSecret = file.secrets.some((secret) => {
            const now = new Date();
            const hasViewsRemaining = secret.views === null || secret.views >= 0;
            const notExpired = secret.expiresAt > now;
            return hasViewsRemaining && notExpired;
        });

        if (!hasValidSecret) {
            return c.json({ error: 'File not found' }, 404);
        }

        // Validate path is within upload directory to prevent path traversal
        if (!isPathSafe(file.path)) {
            console.error(`Path traversal attempt detected: ${file.path}`);
            return c.json({ error: 'File not found' }, 404);
        }

        // Stream the file instead of loading it entirely into memory
        const nodeStream = createReadStream(file.path);
        const webStream = Readable.toWeb(nodeStream) as ReadableStream;

        return stream(c, async (s) => {
            s.onAbort(() => {
                nodeStream.destroy();
            });
            await s.pipe(webStream);
        });
    } catch (error) {
        console.error('Failed to download file:', error);
        return c.json({ error: 'Failed to download file' }, 500);
    }
});

files.post('/', authMiddleware, async (c) => {
    try {
        // Check if file uploads are allowed
        const instanceSettings = await resolveSettings();
        const allowFileUploads = instanceSettings?.allowFileUploads ?? true;

        if (!allowFileUploads) {
            return c.json({ error: 'File uploads are disabled on this instance.' }, 403);
        }

        const maxFileSize = await getMaxFileSize();
        const rawFilename = decodeUploadFilenameHeader(c.req.header('X-File-Name'));

        if (rawFilename) {
            const fileSize = getUploadSizeFromHeaders(c.req.raw.headers);
            if (fileSize === null) {
                return c.json({ error: 'File size is required.' }, 400);
            }

            if (fileSize > maxFileSize) {
                return c.json(
                    { error: `File size exceeds the limit of ${maxFileSize / 1024 / 1024}MB.` },
                    413
                );
            }

            if (!c.req.raw.body) {
                return c.json({ error: 'File body is required.' }, 400);
            }

            const id = nanoid();
            const safePath = generateSafeFilePath(id, rawFilename);

            if (!safePath) {
                console.error(`Path traversal attempt in upload: ${rawFilename}`);
                return c.json({ error: 'Invalid filename' }, 400);
            }

            const nodeStream = Readable.fromWeb(
                c.req.raw.body as import('stream/web').ReadableStream
            );

            await writeUploadStream(nodeStream, safePath.path);

            const newFile = await prisma.file.create({
                data: { id, filename: safePath.filename, path: safePath.path },
            });

            return c.json({ id: newFile.id }, 201);
        }

        const body = await c.req.parseBody();
        const file = body['file'];

        if (!(file instanceof File)) {
            return c.json({ error: 'File is required and must be a file.' }, 400);
        }

        if (file.size > maxFileSize) {
            return c.json(
                { error: `File size exceeds the limit of ${maxFileSize / 1024 / 1024}MB.` },
                413
            );
        }

        const id = nanoid();
        const safePath = generateSafeFilePath(id, file.name);

        if (!safePath) {
            console.error(`Path traversal attempt in upload: ${file.name}`);
            return c.json({ error: 'Invalid filename' }, 400);
        }

        // Stream the file to disk instead of loading it entirely into memory
        const webStream = file.stream();
        const nodeStream = Readable.fromWeb(webStream as import('stream/web').ReadableStream);
        await writeUploadStream(nodeStream, safePath.path);

        const newFile = await prisma.file.create({
            data: { id, filename: safePath.filename, path: safePath.path },
        });

        return c.json({ id: newFile.id }, 201);
    } catch (error) {
        console.error('Failed to upload file:', error);
        return c.json({ error: 'Failed to upload file' }, 500);
    }
});

export default files;
