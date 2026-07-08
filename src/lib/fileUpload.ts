export interface FileUploadProgress {
    loaded: number;
    total: number;
    percent: number;
    bytesPerSecond: number;
}

interface UploadFileOptions {
    file: Blob;
    filename: string;
    onProgress?: (progress: FileUploadProgress) => void;
    xhrFactory?: () => XMLHttpRequest;
    now?: () => number;
}

interface UploadFileResponse {
    id: string;
}

function extractUploadError(responseText: string): string {
    if (!responseText) return 'File upload failed';

    try {
        const data = JSON.parse(responseText) as { error?: unknown };
        if (typeof data.error === 'string') {
            return data.error;
        }
    } catch {
        // Response is not JSON; fall through to the raw text.
    }

    return responseText || 'File upload failed';
}

export function formatUploadSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond < 1024) {
        return `${Math.round(bytesPerSecond)} B/s`;
    }

    if (bytesPerSecond < 1024 * 1024) {
        return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    }

    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
}

export function getFileUploadKey(file: File): string {
    return `${file.name}-${file.size}-${file.lastModified}`;
}

export function uploadFileWithProgress({
    file,
    filename,
    onProgress,
    xhrFactory = () => new XMLHttpRequest(),
    now = () => Date.now(),
}: UploadFileOptions): Promise<UploadFileResponse> {
    return new Promise((resolve, reject) => {
        const xhr = xhrFactory();
        const startedAt = now();

        xhr.open('POST', '/api/files');
        xhr.withCredentials = true;
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(filename));
        xhr.setRequestHeader('X-File-Size', String(file.size));
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

        xhr.upload.addEventListener('progress', (event) => {
            if (!event.lengthComputable) return;

            const elapsedSeconds = Math.max((now() - startedAt) / 1000, 0.001);
            const total = event.total || file.size;
            const percent = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;

            onProgress?.({
                loaded: event.loaded,
                total,
                percent,
                bytesPerSecond: event.loaded / elapsedSeconds,
            });
        });

        xhr.addEventListener('load', () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                reject(new Error(extractUploadError(xhr.responseText)));
                return;
            }

            try {
                resolve(JSON.parse(xhr.responseText) as UploadFileResponse);
            } catch {
                reject(new Error('Invalid upload response'));
            }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during file upload')));
        xhr.addEventListener('abort', () => reject(new Error('File upload was aborted')));

        xhr.send(file);
    });
}
