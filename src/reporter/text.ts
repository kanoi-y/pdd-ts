export function markdownText(value: string): string {
    return value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/[\\`*_{}\[\]()|#!]/g, char => '\\' + char);
}
