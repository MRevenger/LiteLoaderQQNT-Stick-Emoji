const pluginName = hexToAnsi('#20e8e8') + "[Stick-Emoji Renderer] " + '\x1b[0m'

function hexToAnsi(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `\x1b[38;2;${r};${g};${b}m`;
}

export function pluginLog(message) {
    return console.log(pluginName + message)
}

export function pluginDebug(message) {
    pluginLog(message)
    try { window.stick_emoji?.debugLog?.(String(message)) } catch { }
}
