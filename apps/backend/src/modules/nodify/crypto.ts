import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export class SecretBox {
    private readonly key: Buffer;
    constructor(directory = process.env.NODIFY_DATA_DIR || resolve('data/nodify')) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const filename = resolve(directory, 'master.key');
        if (!existsSync(filename)) {
            try {
                writeFileSync(filename, randomBytes(32), { mode: 0o600, flag: 'wx' });
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            }
        }
        this.key = readFileSync(filename);
        if (this.key.length !== 32) throw new Error('Invalid Nodify master key');
    }
    seal(value: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    }
    open(value: string): string {
        const data = Buffer.from(value, 'base64');
        const cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
        cipher.setAuthTag(data.subarray(12, 28));
        return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
    }
}
