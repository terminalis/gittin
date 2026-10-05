export function safeURL(value: string, image = false): string {
    const compact = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(compact) && !(image ? /^https?:/i : /^(?:https?|mailto|tel):/i).test(compact))
        return '';
    return value;
}
