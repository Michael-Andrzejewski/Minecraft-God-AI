import { readFileSync } from 'fs';
import path from 'path';

let keys = {};
try {
    const keysPath = path.join(process.cwd(), 'keys.json');
    const data = readFileSync(keysPath, 'utf8');
    keys = JSON.parse(data);
} catch (err) {
    console.warn('keys.json not found or invalid. Defaulting to environment variables.');
}

export function getKey(name) {
    let key = keys[name];
    if (!key) {
        key = process.env[name];
    }
    if (!key) {
        throw new Error(`API key "${name}" not found in keys.json or environment variables!`);
    }
    return key;
}

export function hasKey(name) {
    return Boolean(keys[name] || process.env[name]);
}
