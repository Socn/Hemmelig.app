import { mkdir } from 'fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'path';
import { FILE } from './constants';
import { resolveSettings } from './settings';

/** Upload directory path */
export const UPLOAD_DIR = resolve(process.cwd(), 'uploads');

/**
 * Sanitizes a filename by removing path traversal sequences and directory separators.
 * Returns only the base filename to prevent directory escape attacks.
 */
function sanitizeFilename(filename: string): string {
    // Get only the base filename, stripping any directory components
    const base = basename(filename);
    // Remove any remaining null bytes or other dangerous characters
    return base.replace(/[\x00-\x1f]/g, '');
}

/**
 * Validates that a file path is safely within the upload directory.
 * Prevents path traversal attacks by checking the resolved absolute path.
 */
export function isPathSafe(filePath: string): boolean {
    const resolvedPath = resolve(filePath);
    const relativePath = relative(UPLOAD_DIR, resolvedPath);
    return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

/**
 * Gets max file size from instance settings (in KB), converted to bytes.
 * Defaults to 10MB if not configured.
 */
export async function getMaxFileSize(): Promise<number> {
    const settings = await resolveSettings();
    const maxSecretSizeKB = settings?.maxSecretSize ?? FILE.DEFAULT_MAX_SIZE_KB;
    return maxSecretSizeKB * 1024; // Convert KB to bytes
}

/**
 * Ensures the upload directory exists, creating it if necessary.
 */
async function ensureUploadDir(): Promise<void> {
    try {
        await mkdir(UPLOAD_DIR, { recursive: true });
    } catch (error) {
        console.error('Failed to create upload directory:', error);
    }
}

/**
 * Generates a safe file path within the upload directory.
 * @param id - Unique identifier for the file
 * @param originalFilename - Original filename to sanitize
 * @returns Object with sanitized filename and full path, or null if invalid
 */
export function generateSafeFilePath(
    id: string,
    originalFilename: string
): { filename: string; path: string } | null {
    const safeFilename = sanitizeFilename(originalFilename);
    if (!safeFilename) {
        return null;
    }

    const filename = `${id}-${safeFilename}`;
    const path = join(UPLOAD_DIR, filename);

    // Verify path is safe
    if (!isPathSafe(path)) {
        return null;
    }

    return { filename, path };
}

export function decodeUploadFilenameHeader(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

export function getUploadSizeFromHeaders(headers: Headers): number | null {
    const rawSize = headers.get('X-File-Size') ?? headers.get('Content-Length');
    if (!rawSize) {
        return null;
    }

    const size = Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 0) {
        return null;
    }

    return size;
}

// Initialize upload directory on module load
ensureUploadDir();
