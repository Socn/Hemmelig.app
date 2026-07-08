import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    formatUploadSpeed,
    getFileUploadKey,
    uploadFileWithProgress,
} from '../../src/lib/fileUpload';

type Listener = () => void;
type ProgressListener = (event: ProgressEvent) => void;

class FakeXMLHttpRequest {
    static latest: FakeXMLHttpRequest | null = null;

    upload = {
        listeners: new Map<string, ProgressListener[]>(),
        addEventListener: (type: string, listener: ProgressListener) => {
            const listeners = this.upload.listeners.get(type) ?? [];
            listeners.push(listener);
            this.upload.listeners.set(type, listeners);
        },
    };

    listeners = new Map<string, Listener[]>();
    requestHeaders: Record<string, string> = {};
    method = '';
    url = '';
    body: BodyInit | null = null;
    status = 200;
    responseText = '{"id":"file_123"}';
    withCredentials = false;

    constructor() {
        FakeXMLHttpRequest.latest = this;
    }

    open(method: string, url: string) {
        this.method = method;
        this.url = url;
    }

    setRequestHeader(name: string, value: string) {
        this.requestHeaders[name] = value;
    }

    addEventListener(type: string, listener: Listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    send(body: BodyInit) {
        this.body = body;
    }

    emit(type: string) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener();
        }
    }

    emitProgress(loaded: number, total: number) {
        const event = { lengthComputable: true, loaded, total } as ProgressEvent;
        for (const listener of this.upload.listeners.get('progress') ?? []) {
            listener(event);
        }
    }
}

describe('formatUploadSpeed', () => {
    it('formats bytes per second as human-readable upload speed', () => {
        assert.equal(formatUploadSpeed(512), '512 B/s');
        assert.equal(formatUploadSpeed(1536), '1.5 KB/s');
        assert.equal(formatUploadSpeed(2 * 1024 * 1024), '2.0 MB/s');
    });
});

describe('getFileUploadKey', () => {
    it('builds a stable key from file identity fields', () => {
        const file = new File(['secret'], 'secret.txt', { type: 'text/plain', lastModified: 123 });

        assert.equal(getFileUploadKey(file), 'secret.txt-6-123');
    });
});

describe('uploadFileWithProgress', () => {
    it('uploads a blob with raw body headers and reports progress percentage and speed', async () => {
        const progressEvents: { percent: number; bytesPerSecond: number }[] = [];
        const uploadPromise = uploadFileWithProgress({
            file: new Blob(['a'.repeat(1000)], { type: 'text/plain' }),
            filename: 'secret.txt',
            xhrFactory: () => new FakeXMLHttpRequest() as unknown as XMLHttpRequest,
            now: (() => {
                const times = [1000, 2000];
                return () => times.shift() ?? 2000;
            })(),
            onProgress: (progress) =>
                progressEvents.push({
                    percent: progress.percent,
                    bytesPerSecond: progress.bytesPerSecond,
                }),
        });

        const xhr = FakeXMLHttpRequest.latest;
        assert.ok(xhr);
        assert.equal(xhr.method, 'POST');
        assert.equal(xhr.url, '/api/files');
        assert.equal(xhr.requestHeaders['X-File-Name'], encodeURIComponent('secret.txt'));
        assert.equal(xhr.requestHeaders['X-File-Size'], '1000');
        assert.equal(xhr.requestHeaders['Content-Type'], 'text/plain');
        assert.equal(xhr.body instanceof Blob, true);

        xhr.emitProgress(500, 1000);
        xhr.emitProgress(1000, 1000);
        xhr.emit('load');

        assert.deepEqual(progressEvents, [
            { percent: 50, bytesPerSecond: 500 },
            { percent: 100, bytesPerSecond: 1000 },
        ]);
        await assert.doesNotReject(uploadPromise);
        assert.deepEqual(await uploadPromise, { id: 'file_123' });
    });

    it('rejects with the server error message for failed uploads', async () => {
        const uploadPromise = uploadFileWithProgress({
            file: new Blob(['secret']),
            filename: 'secret.txt',
            xhrFactory: () => new FakeXMLHttpRequest() as unknown as XMLHttpRequest,
        });

        const xhr = FakeXMLHttpRequest.latest;
        assert.ok(xhr);
        xhr.status = 413;
        xhr.responseText = '{"error":"File is too large"}';
        xhr.emit('load');

        await assert.rejects(uploadPromise, /File is too large/);
    });
});
