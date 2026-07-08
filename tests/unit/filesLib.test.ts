import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
    decodeUploadFilenameHeader,
    generateSafeFilePath,
    getUploadSizeFromHeaders,
    isPathSafe,
    UPLOAD_DIR,
} from '../../api/lib/files';

describe('file path safety', () => {
    it('accepts generated upload paths inside the upload directory', () => {
        const safePath = generateSafeFilePath('file-id', 'secret.txt');

        assert.ok(safePath);
        assert.equal(isPathSafe(safePath.path), true);
    });

    it('rejects paths outside the upload directory', () => {
        assert.equal(isPathSafe(join(UPLOAD_DIR, '..', 'secret.txt')), false);
    });
});

describe('raw upload headers', () => {
    it('decodes URL-encoded upload filenames', () => {
        assert.equal(decodeUploadFilenameHeader('secret%20file.txt'), 'secret file.txt');
    });

    it('returns null for malformed encoded filenames', () => {
        assert.equal(decodeUploadFilenameHeader('%E0%A4%A'), null);
    });

    it('reads file size from X-File-Size before Content-Length', () => {
        const headers = new Headers({
            'X-File-Size': '1234',
            'Content-Length': '9999',
        });

        assert.equal(getUploadSizeFromHeaders(headers), 1234);
    });

    it('rejects missing, negative, or non-numeric upload sizes', () => {
        assert.equal(getUploadSizeFromHeaders(new Headers()), null);
        assert.equal(getUploadSizeFromHeaders(new Headers({ 'X-File-Size': '-1' })), null);
        assert.equal(getUploadSizeFromHeaders(new Headers({ 'X-File-Size': 'abc' })), null);
    });
});
