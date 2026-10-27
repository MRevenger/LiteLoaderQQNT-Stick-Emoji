import {getRandomInt} from "./math.js";
import {pluginDebug} from "./frontLog.js";
import {qqEmojiList} from "../assests/qq_emoji.js";
import {getSelfUin} from "./qqStore.js";

const pluginAPI = window.stick_emoji
const msgIdHandlingList = []
const handledMsgIds = new Set()

export async function stickEmojiSelf(payload, config) {
    const msgList = Array.isArray(payload?.msgList) ? payload.msgList : []
    if (msgList.length === 0) return
    if (!config) config = await pluginAPI.getConfig()

    const selfId = getSelfUin()
    if (selfId == null) {
        pluginDebug("取不到自己的QQ号，为免贴到别人的消息上，本次跳过")
        return
    }

    for (const msg of msgList) {
        try {
            if (!shouldStick(msg, selfId)) continue
            await stickToMsg(msg, config)
        } catch (e) {
            pluginDebug("贴表情失败(" + msg?.msgId + "): " + (e?.stack ?? e))
        }
    }
}

// QQ 9.9.x 里自己的标识是 uid（u_xxx），老版本是 senderUin（数字），两个都比一次
function isSelf(msg, selfId) {
    if (msg.senderUid != null && String(msg.senderUid) === String(selfId)) return true
    if (msg.senderUin != null && String(msg.senderUin) === String(selfId)) return true
    return false
}

function shouldStick(msg, selfId) {
    if (!msg || handledMsgIds.has(msg.msgId)) return false
    if (msg.sendStatus !== 2) return false//发送中/发送失败不管
    if (msg.chatType === 1) return false//私聊无法贴表情
    if (msg.elements?.[0]?.grayTipElement != null) return false//小灰条不管
    if (msg.emojiLikesList?.length) return false//已经有表情了不管
    if (!isSelf(msg, selfId)) return false
    return true
}

async function stickToMsg(msg, config) {
    const {chatType, peerUid, msgSeq, msgId} = msg
    handledMsgIds.add(msgId)

    if (!config.useCarousel) {
        for (const emojiId of getEmojis(config.stickSelfAmount)) {
            await setEmojiLike(true, chatType, peerUid, msgSeq, emojiId)
        }
        return
    }

    //走马灯：贴上→撕掉循环，最后一轮停在"已贴上"，否则净效果为零
    if (msgIdHandlingList.some(id => id === msgId)) return
    msgIdHandlingList.push(msgId)
    let carouselCount = 0
    const executeSticking = async () => {
        carouselCount++
        const isLast = carouselCount >= config.carouselCircle
        const emojiIdArray = getEmojis(config.stickSelfAmount)
        for (const emojiId of emojiIdArray) {
            await setEmojiLike(true, chatType, peerUid, msgSeq, emojiId)
            await sleep(config.carouselInterval)
        }
        if (isLast) {
            const index = msgIdHandlingList.indexOf(msgId)
            if (index >= 0) msgIdHandlingList.splice(index, 1)
            return
        }
        for (const emojiId of emojiIdArray) {
            await setEmojiLike(false, chatType, peerUid, msgSeq, emojiId)
            await sleep(config.carouselInterval)
        }
        executeSticking()
    }
    executeSticking().catch(e => pluginDebug("走马灯异常: " + (e?.stack ?? e)))
}

export async function stickEmojiOther(chatType, peerUid, msgSeq) {
    const config = await pluginAPI.getConfig()
    for (let i = 0; i < config.stickOtherAmount; i++) {
        await setEmojiLike(true, chatType, peerUid, msgSeq, randomEmojiId())
    }
}

async function setEmojiLike(setEmoji, chatType, peerUid, msgSeq, emojiId) {
    return pluginAPI.invokeNative("nodeIKernelMsgService/setMsgEmojiLikes", {
        "peer": {"chatType": chatType, "peerUid": peerUid, "guildId": ""},
        "emojiId": String(emojiId),
        "emojiType": "1",//1 = QQ 表情，2 = 系统 Emoji
        "msgSeq": String(msgSeq),
        "setEmoji": setEmoji,
    }, null)
}

function randomEmojiId() {
    const item = qqEmojiList[getRandomInt(0, qqEmojiList.length - 1)]
    return String(item?.emojiId ?? 0)
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function getEmojis(amount) {
    const indices = new Set();
    const total = qqEmojiList.length
    const count = Math.max(0, Math.min(amount, total))
    while (indices.size < count) {
        indices.add(Math.floor(Math.random() * total));
    }
    return Array.from(indices).map(index => qqEmojiList[index].emojiId)
}
