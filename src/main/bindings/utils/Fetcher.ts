import fetch from 'cross-fetch';

export async function fetchText(url: string): Promise<string> {
    if (url.startsWith("file://")) {
        return new Promise(((resolve, reject) => {
            const res = require("fs").readFileSync(url.replace("file://", ""));
            resolve(res.toString())
        }));
    } else {
        const response = await fetch(url);
        const text = await response.text();
        return text;
    }
}