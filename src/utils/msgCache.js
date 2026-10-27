// 9.9.28 取不到 pinia 的 curMsgs，改用消息事件流缓存 msgId -> 会话信息，
// 供右键"贴表情"定位目标消息。
const CACHE_LIMIT = 800
const cache = new Map()

export function rememberMessages(msgList) {
    if (!Array.isArray(msgList)) return
    for (const msg of msgList) {
        if (!msg?.msgId) continue
        cache.delete(msg.msgId)
        cache.set(String(msg.msgId), {
            chatType: msg.chatType,
            peerUid: msg.peerUid,
            msgSeq: msg.msgSeq
        })
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
    }
}

export function lookupMessage(msgId) {
    return cache.get(String(msgId)) ?? null
}

export function cacheSize() {
    return cache.size
}
